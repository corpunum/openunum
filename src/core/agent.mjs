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

export class OpenUnumAgent {
  constructor({ config, memoryStore }) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.toolRuntime = new ToolRuntime(config);
  }

  getCurrentModel() {
    return { provider: this.config.model.provider, model: this.config.model.model };
  }

  switchModel(provider, model) {
    this.config.model.provider = provider;
    this.config.model.model = model;
    return this.getCurrentModel();
  }

  async runTool(name, args) {
    return this.toolRuntime.run(name, args || {});
  }

  reloadTools() {
    this.toolRuntime = new ToolRuntime(this.config);
  }

  async chat({ message, sessionId = crypto.randomUUID() }) {
    if (isModelInfoQuestion(message)) {
      const paramsB = inferParamsB(this.config.model.model);
      const reply = [
        `Runtime provider/model: ${this.config.model.provider}/${this.config.model.model}`,
        paramsB ? `Estimated parameter size: ~${paramsB}B (parsed from model id)` : 'Estimated parameter size: unknown from id',
        'Context window: not guaranteed from runtime config; provider metadata endpoint is the source of truth.'
      ].join('\n');
      this.memoryStore.addMessage(sessionId, 'user', message);
      this.memoryStore.addMessage(sessionId, 'assistant', reply);
      return { sessionId, reply, model: this.getCurrentModel() };
    }

    const provider = buildProvider(this.config);
    const skills = loadSkills();

    this.memoryStore.addMessage(sessionId, 'user', message);

    const skillPrompt = skills
      .map((s) => `Skill ${s.name}:\n${s.content.substring(0, 2000)}`)
      .join('\n\n');

    const facts = this.memoryStore.retrieveFacts(message, 5)
      .map((f) => `${f.key}: ${f.value}`)
      .join('\n');

    const history = this.memoryStore.getMessages(sessionId, 40).map((m) => ({ role: m.role, content: m.content }));
    const messages = [
      {
        role: 'system',
        content:
          `You are OpenUnum, an Ubuntu operator agent. Current runtime provider/model is ${this.config.model.provider}/${this.config.model.model}. ` +
          'If user asks which model/provider you are using, answer with exactly that runtime value and do not invent other providers.\n' +
          'Use tools aggressively to complete tasks end-to-end.\n' +
          (facts ? `Relevant memory:\n${facts}\n` : '') +
          (skillPrompt ? `Loaded skills:\n${skillPrompt}` : '')
      },
      ...history
    ];

    const maxIters = this.config.runtime?.maxToolIterations ?? 4;
    let finalText = '';

    for (let i = 0; i < maxIters; i += 1) {
      const out = await provider.chat({ messages, tools: this.toolRuntime.toolSchemas() });
      if (out.content) {
        finalText = out.content;
        messages.push({ role: 'assistant', content: out.content });
      }

      if (!out.toolCalls || out.toolCalls.length === 0) break;

      for (const tc of out.toolCalls) {
        let args = {};
        try {
          args = JSON.parse(tc.arguments || '{}');
        } catch {
          args = {};
        }

        let result;
        try {
          result = await this.toolRuntime.run(tc.name, args);
        } catch (error) {
          result = { ok: false, error: String(error.message || error) };
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        });
      }
    }

    if (!finalText) finalText = 'No response generated.';
    this.memoryStore.addMessage(sessionId, 'assistant', finalText);

    if (message.toLowerCase().startsWith('remember ')) {
      const payload = message.slice('remember '.length);
      const [key, ...rest] = payload.split(':');
      if (key && rest.length > 0) {
        this.memoryStore.rememberFact(key.trim(), rest.join(':').trim());
      }
    }

    return { sessionId, reply: finalText, model: this.getCurrentModel() };
  }
}
