import crypto from 'node:crypto';
import { buildProvider } from '../providers/index.mjs';
import { ToolRuntime } from '../tools/runtime.mjs';
import { loadSkills } from '../skills/loader.mjs';

function inferParamsB(modelId) {
  const m = String(modelId || '').toLowerCase().match(/(\d+(?:\.\d+)?)b/);
  return m ? Number(m[1]) : null;
}

function isModelInfoQuestion(text) {
  const t = String(text || '').toLowerCase();
  return (
    t.includes('which llm') ||
    t.includes('what model') ||
    t.includes('what llm') ||
    t.includes('context window') ||
    t.includes('parameter') ||
    t.includes('billion')
  );
}

function normalizeModelForProvider(provider, model) {
  const raw = String(model || '').replace(/^(ollama|openrouter|nvidia|generic)\//, '');
  return `${provider}/${raw}`;
}

function uniq(arr) {
  return [...new Set(arr)];
}

function parseToolArgs(rawArgs) {
  if (rawArgs == null) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  if (typeof rawArgs !== 'string') return {};
  try {
    return JSON.parse(rawArgs || '{}');
  } catch {
    return {};
  }
}

function summarizeResult(result) {
  const r = result || {};
  return {
    ok: Boolean(r.ok),
    code: Number.isFinite(r.code) ? r.code : undefined,
    error: r.error || null,
    path: r.path || r.outPath || null,
    url: r.url || null
  };
}

export class OpenUnumAgent {
  constructor({ config, memoryStore }) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.toolRuntime = new ToolRuntime(config, memoryStore);
    this.lastRuntime = {
      provider: config.model.provider,
      model: config.model.model
    };
  }

  getCurrentModel() {
    return {
      provider: this.config.model.provider,
      model: this.config.model.model,
      activeProvider: this.lastRuntime?.provider || this.config.model.provider,
      activeModel: this.lastRuntime?.model || this.config.model.model
    };
  }

  switchModel(provider, model) {
    this.config.model.provider = provider;
    this.config.model.model = model;
    this.config.model.providerModels = this.config.model.providerModels || {};
    this.config.model.providerModels[provider] = model;
    return this.getCurrentModel();
  }

  async runTool(name, args) {
    return this.toolRuntime.run(name, args || {});
  }

  reloadTools() {
    this.toolRuntime = new ToolRuntime(this.config, this.memoryStore);
  }

  getModelForProvider(provider) {
    const fallback = normalizeModelForProvider(provider, this.config.model.model);
    return this.config.model.providerModels?.[provider] || fallback;
  }

  buildProviderAttempts() {
    const preferred = this.config.model.provider;
    if (this.config.model.routing?.forcePrimaryProvider) {
      return [{ provider: preferred, model: this.config.model.model }];
    }
    const fallbackEnabled = this.config.model.routing?.fallbackEnabled !== false;
    const fallbacks = fallbackEnabled ? (this.config.model.routing?.fallbackProviders || []) : [];
    const providers = uniq([preferred, ...fallbacks]).filter(Boolean);
    return providers.map((provider) => ({
      provider,
      model: provider === preferred ? this.config.model.model : this.getModelForProvider(provider)
    }));
  }

  async runOneProviderTurn({ provider, model, messages, sessionId }) {
    const attemptConfig = {
      ...this.config,
      model: {
        ...this.config.model,
        provider,
        model
      }
    };
    const runtimeProvider = buildProvider(attemptConfig);
    const maxIters = this.config.runtime?.maxToolIterations ?? 4;
    let finalText = '';
    let toolRuns = 0;
    let lastToolResult = null;
    const executedTools = [];
    const trace = {
      provider,
      model,
      iterations: [],
      recoveryUsed: false
    };

    for (let i = 0; i < maxIters; i += 1) {
      const out = await runtimeProvider.chat({ messages, tools: this.toolRuntime.toolSchemas() });
      const iter = {
        step: i + 1,
        toolCalls: [],
        assistantText: out.content || ''
      };
      if (out.content) {
        finalText = out.content;
        messages.push({ role: 'assistant', content: out.content });
      }

      if (!out.toolCalls || out.toolCalls.length === 0) {
        trace.iterations.push(iter);
        break;
      }

      for (const tc of out.toolCalls) {
        const args = parseToolArgs(tc.arguments);

        let result;
        try {
          result = await this.toolRuntime.run(tc.name, args, { sessionId });
        } catch (error) {
          result = { ok: false, error: String(error.message || error) };
        }
        toolRuns += 1;
        lastToolResult = result;
        executedTools.push({
          name: tc.name,
          args,
          result
        });
        iter.toolCalls.push({
          name: tc.name,
          args,
          result: summarizeResult(result)
        });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        });
      }
      trace.iterations.push(iter);
    }

    if (!finalText && toolRuns > 0) {
      try {
        trace.recoveryUsed = true;
        const recoveryMessages = [
          ...messages,
          {
            role: 'system',
            content:
              'Provide a concise final status update based only on completed tool results. ' +
              'Do not call tools. Include what succeeded, what failed, and next concrete step.'
          }
        ];
        const recovery = await runtimeProvider.chat({ messages: recoveryMessages, tools: [] });
        if (recovery?.content) {
          finalText = recovery.content;
        }
      } catch {
        // ignore and fallback to synthesized summary below
      }
    }

    if (!finalText && toolRuns > 0) {
      const recent = executedTools.slice(-4).map((t, idx) =>
        `${idx + 1}. ${t.name}(${JSON.stringify(t.args)}) => ${JSON.stringify(t.result)}`
      );
      finalText = [
        `Tool actions executed (${toolRuns}) but model returned no final message.`,
        'Executed actions:',
        ...recent,
        'Next step: continue from the current page and extract concrete results before claiming completion.'
      ].join('\n');
    }
    if (!finalText) finalText = 'No response generated.';
    this.lastRuntime = { provider, model };
    this.config.model.providerModels = this.config.model.providerModels || {};
    this.config.model.providerModels[provider] = model;
    return { finalText, trace };
  }

  async chat({ message, sessionId = crypto.randomUUID() }) {
    if (isModelInfoQuestion(message)) {
      const paramsB = inferParamsB(this.config.model.model);
      const reply = [
        `Configured provider/model: ${this.config.model.provider}/${this.config.model.model}`,
        `Last active provider/model: ${this.lastRuntime?.provider || this.config.model.provider}/${this.lastRuntime?.model || this.config.model.model}`,
        paramsB ? `Estimated parameter size: ~${paramsB}B (parsed from model id)` : 'Estimated parameter size: unknown from id',
        'Context window: not guaranteed from runtime config; provider metadata endpoint is the source of truth.'
      ].join('\n');
      this.memoryStore.addMessage(sessionId, 'user', message);
      this.memoryStore.addMessage(sessionId, 'assistant', reply);
      return {
        sessionId,
        reply,
        model: this.getCurrentModel(),
        trace: {
          provider: this.config.model.provider,
          model: this.config.model.model,
          iterations: [],
          note: 'Model info response generated directly from runtime state.'
        }
      };
    }

    const skills = loadSkills();

    this.memoryStore.addMessage(sessionId, 'user', message);

    const skillPrompt = skills
      .map((s) => `Skill ${s.name}:\n${s.content.substring(0, 2000)}`)
      .join('\n\n');
    const strategyHints = this.memoryStore.retrieveStrategyHints(message, 4);
    const strategyPrompt = strategyHints.length
      ? strategyHints
        .map((s, idx) => `${idx + 1}. ${s.success ? 'SUCCESS' : 'FAIL'} | ${s.strategy} | ${s.evidence}`)
        .join('\n')
      : '';

    const facts = this.memoryStore.retrieveFacts(message, 5)
      .map((f) => `${f.key}: ${f.value}`)
      .join('\n');

    const history = this.memoryStore.getMessages(sessionId, 40).map((m) => ({ role: m.role, content: m.content }));
    const messages = [
      {
        role: 'system',
        content:
          `You are OpenUnum, an Ubuntu operator agent. Current configured provider/model is ${this.config.model.provider}/${this.config.model.model}. ` +
          'If user asks which model/provider you are using, answer with exactly that runtime value and do not invent other providers.\n' +
          'Never claim an action was completed unless a tool result in this turn confirms it.\n' +
          'For browser tasks: if browser flow is blocked, pivot to terminal/script strategy immediately (curl/wget/git/python/node) and continue.\n' +
          'Prefer the quickest reliable execution path and build short scripts when it improves completion.\n' +
          'Use tools aggressively to complete tasks end-to-end.\n' +
          (facts ? `Relevant memory:\n${facts}\n` : '') +
          (strategyPrompt ? `Previous strategy outcomes for related tasks:\n${strategyPrompt}\n` : '') +
          (skillPrompt ? `Loaded skills:\n${skillPrompt}` : '')
      },
      ...history
    ];

    let finalText = '';
    const attempts = this.buildProviderAttempts();
    const failures = [];
    let trace = null;

    for (const attempt of attempts) {
      try {
        const run = await this.runOneProviderTurn({
          provider: attempt.provider,
          model: attempt.model,
          messages: [...messages],
          sessionId
        });
        finalText = run.finalText;
        trace = run.trace;
        break;
      } catch (error) {
        failures.push(`${attempt.provider}: ${String(error.message || error)}`);
      }
    }

    if (!finalText) {
      finalText = `All configured providers failed.\n${failures.join('\n')}`;
      trace = {
        provider: this.config.model.provider,
        model: this.config.model.model,
        iterations: [],
        failures
      };
    }
    this.memoryStore.addMessage(sessionId, 'assistant', finalText);

    if (message.toLowerCase().startsWith('remember ')) {
      const payload = message.slice('remember '.length);
      const [key, ...rest] = payload.split(':');
      if (key && rest.length > 0) {
        this.memoryStore.rememberFact(key.trim(), rest.join(':').trim());
      }
    }

    return { sessionId, reply: finalText, model: this.getCurrentModel(), trace };
  }
}
