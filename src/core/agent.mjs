import crypto from 'node:crypto';
import { buildProvider } from '../providers/index.mjs';
import { ToolRuntime } from '../tools/runtime.mjs';
import { loadSkills } from '../skills/loader.mjs';
import { buildContextBudgetInfo, estimateMessagesTokens } from './context-budget.mjs';
import { compactSessionMessages } from './context-compact.mjs';

function inferParamsB(modelId) {
  const m = String(modelId || '').toLowerCase().match(/(\d+(?:\.\d+)?)b/);
  return m ? Number(m[1]) : null;
}

function isModelInfoQuestion(text) {
  const t = String(text || '').toLowerCase();
  const asksActiveModel =
    t.includes('which model are you using') ||
    t.includes('what model are you using') ||
    t.includes('current model') ||
    t.includes('which llm are you using') ||
    t.includes('what llm are you using') ||
    t.includes('provider/model');
  const asksCatalog =
    t.includes('what models we have') ||
    t.includes('which models we have') ||
    t.includes('list models') ||
    t.includes('locally') ||
    t.includes('in a table');
  return asksActiveModel && !asksCatalog;
}

function normalizeModelForProvider(provider, model) {
  const normalizedProvider = String(provider || 'ollama').trim().toLowerCase() === 'generic' ? 'openai' : String(provider || 'ollama').trim().toLowerCase();
  const raw = String(model || '').replace(/^(ollama|openrouter|nvidia|generic|openai)\//, '');
  return `${normalizedProvider}/${raw}`;
}

function providerModelLabel(provider, model) {
  const p = String(provider || '').trim().toLowerCase() === 'generic' ? 'openai' : String(provider || '').trim();
  const m = String(model || '').trim();
  if (!p) return m;
  if (!m) return p;
  if (m.startsWith(`${p}/`)) return m;
  if (/^(ollama|openrouter|nvidia|generic|openai)\//.test(m)) return m.replace(/^generic\//, 'openai/');
  return `${p}/${m}`;
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

function isLikelyCompletionText(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  return (
    t.includes('mission_status: done') ||
    t.includes('done') ||
    t.includes('completed') ||
    t.includes('finished') ||
    t.includes('successfully')
  );
}

const TOOL_ROUTING_HINTS = [
  { tool: 'browser_search', terms: ['search', 'google', 'find online', 'web research', 'browse'] },
  { tool: 'browser_navigate', terms: ['open website', 'navigate', 'visit', 'go to', 'browser'] },
  { tool: 'browser_extract', terms: ['extract', 'scrape', 'read page', 'page text'] },
  { tool: 'file_read', terms: ['read file', 'inspect file', 'open file', 'show file'] },
  { tool: 'file_write', terms: ['create file', 'write file', 'save file'] },
  { tool: 'file_patch', terms: ['patch file', 'edit file', 'replace text', 'modify file'] },
  { tool: 'shell_run', terms: ['run command', 'terminal', 'shell', 'cli', 'install', 'build', 'test'] },
  { tool: 'desktop_open', terms: ['open app', 'open folder', 'open target'] },
  { tool: 'desktop_xdotool', terms: ['desktop', 'window', 'keyboard', 'mouse', 'xdotool'] },
  { tool: 'email_list', terms: ['email', 'gmail', 'inbox'] },
  { tool: 'research_run_daily', terms: ['research', 'daily research'] }
];

function inferRoutedTools(message) {
  const text = String(message || '').toLowerCase();
  const matches = [];
  for (const hint of TOOL_ROUTING_HINTS) {
    let score = 0;
    for (const term of hint.terms) {
      if (text.includes(term)) score += 1;
    }
    if (score > 0) matches.push({ tool: hint.tool, score });
  }
  matches.sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool));
  return matches.slice(0, 5);
}

function parseSlashCommand(message) {
  const text = String(message || '').trim();
  if (!text.startsWith('/')) return null;
  const [command, ...rest] = text.slice(1).split(/\s+/);
  return {
    name: String(command || '').toLowerCase(),
    args: rest,
    raw: text
  };
}

function buildPivotHints({ executedTools = [], permissionDenials = [], timedOut = false, providerFailures = [] }) {
  const hints = [];
  const failedTools = executedTools.filter((item) => item?.result?.ok === false);
  const repeatedFailures = new Map();
  for (const item of failedTools) {
    repeatedFailures.set(item.name, (repeatedFailures.get(item.name) || 0) + 1);
  }

  if (permissionDenials.some((item) => String(item.tool || '').includes('browser'))) {
    hints.push('Browser path was blocked. Pivot to terminal or script execution immediately.');
  }
  if (permissionDenials.some((item) => ['shell_disabled', 'shell_blocked', 'owner_mode_restricted'].includes(item.reason))) {
    hints.push('Shell path is restricted. Use non-shell tools or change owner mode before retrying.');
  }
  if (permissionDenials.some((item) => item.reason === 'tool_circuit_open')) {
    hints.push('A tool circuit is open. Do not retry the same tool family immediately.');
  }
  for (const [toolName, count] of repeatedFailures.entries()) {
    if (count >= 2) {
      hints.push(`${toolName} failed repeatedly. Switch method instead of repeating the same call.`);
    }
  }
  if (timedOut) {
    hints.push('Turn timed out. Narrow the scope or switch to a faster provider/model.');
  }
  if (providerFailures.length >= 2) {
    hints.push('Multiple providers failed. Prefer the healthiest provider path and reduce prompt complexity.');
  }
  return [...new Set(hints)].slice(0, 5);
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
    provider = String(provider || 'ollama').trim().toLowerCase() === 'generic' ? 'openai' : String(provider || 'ollama').trim().toLowerCase();
    this.config.model.provider = provider;
    this.config.model.model = providerModelLabel(provider, model);
    this.config.model.providerModels = this.config.model.providerModels || {};
    this.config.model.providerModels[provider] = this.config.model.model;
    return this.getCurrentModel();
  }

  async runTool(name, args) {
    return this.toolRuntime.run(name, args || {});
  }

  reloadTools() {
    this.toolRuntime = new ToolRuntime(this.config, this.memoryStore);
  }

  getContextStatus(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    const history = this.memoryStore.getMessagesForContext(sid, 1000)
      .map((m) => ({ role: m.role, content: m.content }));
    const model = this.getCurrentModel();
    const budget = buildContextBudgetInfo({
      config: this.config,
      provider: model.activeProvider || model.provider,
      model: model.activeModel || model.model,
      messages: history
    });
    const latestCompaction = this.memoryStore.getLatestSessionCompaction(sid);
    return {
      ok: true,
      sessionId: sid,
      messageCount: history.length,
      estimatedTokens: estimateMessagesTokens(history),
      budget,
      latestCompaction
    };
  }

  compactSessionContext({ sessionId, dryRun = false }) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    const model = this.getCurrentModel();
    const full = this.memoryStore.getMessagesForContext(sid, 2000);
    if (!full.length) return { ok: true, skipped: true, reason: 'no_messages' };
    const contextLimit = buildContextBudgetInfo({
      config: this.config,
      provider: model.activeProvider || model.provider,
      model: model.activeModel || model.model,
      messages: full.map((m) => ({ role: m.role, content: m.content }))
    }).contextLimit;
    const targetTokens = Math.floor(contextLimit * Number(this.config.runtime?.contextCompactTargetPct || 0.4));
    const compacted = compactSessionMessages({
      messages: full,
      targetTokens,
      protectRecentTurns: Number(this.config.runtime?.contextProtectRecentTurns || 8)
    });
    if (!dryRun && compacted.cutoffMessageId > 0) {
      const modelName = `${model.activeProvider || model.provider}/${model.activeModel || model.model}`;
      this.memoryStore.recordSessionCompaction({
        sessionId: sid,
        cutoffMessageId: compacted.cutoffMessageId,
        model: modelName,
        ctxLimit: contextLimit,
        preTokens: compacted.preTokens,
        postTokens: compacted.postTokens,
        summary: compacted.summary
      });
      this.memoryStore.addMemoryArtifacts(sid, compacted.artifacts);
      this.memoryStore.addMessage(sid, 'system', compacted.compactedMessages[0]?.content || 'SESSION COMPACTION CHECKPOINT');
    }
    return {
      ok: true,
      dryRun: Boolean(dryRun),
      cutoffMessageId: compacted.cutoffMessageId,
      preTokens: compacted.preTokens,
      postTokens: compacted.postTokens,
      summary: compacted.summary,
      artifactsCount: compacted.artifacts.length
    };
  }

  listContextCompactions(sessionId, limit = 20) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    return { ok: true, sessionId: sid, compactions: this.memoryStore.listSessionCompactions(sid, limit) };
  }

  listContextArtifacts(sessionId, limit = 40) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    return { ok: true, sessionId: sid, artifacts: this.memoryStore.getMemoryArtifacts(sid, limit) };
  }

  handleSlashCommand(sessionId, slash) {
    const sid = String(sessionId || '').trim();
    const current = this.getCurrentModel();
    if (slash.name === 'help') {
      return [
        'Available slash commands:',
        '/status',
        '/compact',
        '/memory',
        '/cost',
        '/ledger',
        '/session list'
      ].join('\n');
    }
    if (slash.name === 'status') {
      const status = this.getContextStatus(sid);
      return [
        `provider/model: ${providerModelLabel(current.activeProvider || current.provider, current.activeModel || current.model)}`,
        `messages: ${status.messageCount}`,
        `estimated_tokens: ${status.estimatedTokens}`,
        `context_limit: ${status.budget.contextLimit}`,
        `usage_pct: ${(status.budget.usagePct * 100).toFixed(1)}%`,
        `latest_compaction: ${status.latestCompaction ? status.latestCompaction.createdAt : 'none'}`
      ].join('\n');
    }
    if (slash.name === 'compact') {
      const out = this.compactSessionContext({ sessionId: sid, dryRun: false });
      return [
        `compact ok=${out.ok}`,
        `pre_tokens=${out.preTokens}`,
        `post_tokens=${out.postTokens}`,
        `cutoff_message_id=${out.cutoffMessageId}`,
        `artifacts=${out.artifactsCount}`
      ].join('\n');
    }
    if (slash.name === 'memory') {
      const artifacts = this.memoryStore.getMemoryArtifacts(sid, 5);
      const latestCompaction = this.memoryStore.getLatestSessionCompaction(sid);
      return [
        `artifacts: ${artifacts.length}`,
        `latest_compaction: ${latestCompaction ? latestCompaction.createdAt : 'none'}`,
        ...artifacts.slice(0, 5).map((item, index) => `${index + 1}. [${item.type}] ${String(item.content || '').slice(0, 120)}`)
      ].join('\n');
    }
    if (slash.name === 'cost') {
      const messages = this.memoryStore.getAllMessagesForSession(sid).map((m) => ({ role: m.role, content: m.content }));
      const estimatedTokens = estimateMessagesTokens(messages);
      return [
        `session_messages=${messages.length}`,
        `estimated_total_tokens=${estimatedTokens}`,
        'cost_estimate=not provider-billed; token estimate only'
      ].join('\n');
    }
    if (slash.name === 'ledger') {
      const strategies = this.memoryStore.getStrategyLedger ? this.memoryStore.getStrategyLedger({ goal: '', limit: 6 }) : [];
      const tools = this.memoryStore.getToolReliability ? this.memoryStore.getToolReliability(6) : [];
      return [
        `strategy_entries=${strategies.length}`,
        ...strategies.map((item, index) => `${index + 1}. ${item.success ? 'SUCCESS' : 'FAIL'} | ${item.strategy} | ${String(item.evidence || '').slice(0, 100)}`),
        `tool_reliability_entries=${tools.length}`,
        ...tools.map((item, index) => `${index + 1}. ${item.toolName} success_rate=${(item.successRate * 100).toFixed(0)}% total=${item.total}`)
      ].join('\n');
    }
    if (slash.name === 'session' && slash.args[0] === 'list') {
      const sessions = this.memoryStore.listSessions(12);
      return [
        `sessions=${sessions.length}`,
        ...sessions.map((item, index) => `${index + 1}. ${item.sessionId} | ${item.title} | ${item.messageCount} msgs`)
      ].join('\n');
    }
    return null;
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

  async runOneProviderTurn({ provider, model, messages, sessionId, routedTools = [] }) {
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
    const turnBudgetMs = this.config.runtime?.agentTurnTimeoutMs ?? 420000;
    const turnStartedAt = Date.now();
    let finalText = '';
    let toolRuns = 0;
    let lastToolResult = null;
    const executedTools = [];
    const trace = {
      provider,
      model,
      routedTools,
      iterations: [],
      recoveryUsed: false,
      permissionDenials: []
    };
    let forcedContinueCount = 0;

    for (let i = 0; i < maxIters; i += 1) {
      const elapsed = Date.now() - turnStartedAt;
      const remainingMs = turnBudgetMs - elapsed;
      if (remainingMs <= 0) {
        trace.timedOut = true;
        trace.timeoutMs = turnBudgetMs;
        break;
      }
      const out = await runtimeProvider.chat({
        messages,
        tools: this.toolRuntime.toolSchemas(),
        timeoutMs: remainingMs
      });
      const iter = {
        step: i + 1,
        toolCalls: [],
        assistantText: out.content || ''
      };
      if (out.content || (out.toolCalls && out.toolCalls.length > 0)) {
        finalText = out.content;
        const assistantMessage = {
          role: 'assistant',
          content: out.content || ''
        };
        if (out.toolCalls && out.toolCalls.length > 0) {
          assistantMessage.tool_calls = out.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: tc.arguments ?? '{}'
            }
          }));
        }
        messages.push(assistantMessage);
      }

      if (!out.toolCalls || out.toolCalls.length === 0) {
        trace.iterations.push(iter);
        const shouldForceContinue =
          i < maxIters - 1 &&
          toolRuns > 0 &&
          !isLikelyCompletionText(out.content || finalText) &&
          forcedContinueCount < 2;
        if (shouldForceContinue) {
          forcedContinueCount += 1;
          messages.push({
            role: 'system',
            content:
              'Do not stop at planning text. Continue executing concrete actions now using tools. ' +
              'Only provide final answer when task is actually completed from tool evidence.'
          });
          continue;
        }
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
        if (!result?.ok && ['shell_blocked', 'owner_mode_restricted', 'tool_circuit_open', 'shell_disabled', 'unsafe_xdotool_command'].includes(result?.error)) {
          trace.permissionDenials.push({
            tool: tc.name,
            reason: result.error,
            detail: result.stderr || result.error
          });
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

    if (!finalText && trace.timedOut) {
      finalText = [
        `Turn timed out after ${trace.timeoutMs}ms before the model produced a final response.`,
        toolRuns > 0
          ? `Tool actions executed so far: ${toolRuns}. Open execution trace for the latest results.`
          : 'No successful tool output was recorded before timeout.',
        'Retry with a narrower prompt, fewer steps, or a faster model.'
      ].join('\n');
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
    trace.pivotHints = buildPivotHints({
      executedTools,
      permissionDenials: trace.permissionDenials,
      timedOut: Boolean(trace.timedOut)
    });
    trace.turnSummary = {
      toolRuns,
      iterationCount: trace.iterations.length,
      permissionDenials: trace.permissionDenials.length,
      routedTools: routedTools.map((item) => item.tool)
    };
    this.lastRuntime = { provider, model };
    this.config.model.providerModels = this.config.model.providerModels || {};
    this.config.model.providerModels[provider] = model;
    return { finalText, trace };
  }

  async chat({ message, sessionId = crypto.randomUUID() }) {
    const slash = parseSlashCommand(message);
    if (slash) {
      const slashReply = this.handleSlashCommand(sessionId, slash);
      if (slashReply) {
        this.memoryStore.addMessage(sessionId, 'user', message);
        this.memoryStore.addMessage(sessionId, 'assistant', slashReply);
        return {
          sessionId,
          reply: slashReply,
          model: this.getCurrentModel(),
          trace: {
            provider: this.config.model.provider,
            model: this.config.model.model,
            routedTools: [],
            iterations: [],
            permissionDenials: [],
            turnSummary: {
              toolRuns: 0,
              iterationCount: 0,
              permissionDenials: 0,
              routedTools: []
            },
            note: `slash_command:${slash.name}`
          }
        };
      }
    }

    if (isModelInfoQuestion(message)) {
      const configuredLabel = providerModelLabel(this.config.model.provider, this.config.model.model);
      const activeLabel = providerModelLabel(
        this.lastRuntime?.provider || this.config.model.provider,
        this.lastRuntime?.model || this.config.model.model
      );
      const paramsB = inferParamsB(this.lastRuntime?.model || this.config.model.model);
      const reply = [
        `Configured provider/model: ${configuredLabel}`,
        `Last active provider/model: ${activeLabel}`,
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
    const routedTools = inferRoutedTools(message);

    this.memoryStore.addMessage(sessionId, 'user', message);

    const skillPrompt = skills
      .map((s) => `Skill ${s.name}:\n${s.content.substring(0, 2000)}`)
      .join('\n\n');
    const strategyHints = this.memoryStore.retrieveStrategyHintsSmart
      ? this.memoryStore.retrieveStrategyHintsSmart(message, 6)
      : this.memoryStore.retrieveStrategyHints(message, 4);
    const strategyPrompt = strategyHints.length
      ? strategyHints
        .map((s, idx) => `${idx + 1}. ${s.success ? 'SUCCESS' : 'FAIL'} | ${s.strategy} | ${s.evidence}`)
        .join('\n')
      : '';

    const facts = this.memoryStore.retrieveFacts(message, 5)
      .map((f) => `${f.key}: ${f.value}`)
      .join('\n');
    const knowledgeHits = this.memoryStore.searchKnowledge
      ? this.memoryStore.searchKnowledge(message, 6).map((k, idx) => `${idx + 1}. [${k.type}] ${k.text}`).join('\n')
      : '';

    const rawHistory = this.memoryStore.getMessagesForContext(sessionId, 1200)
      .map((m) => ({ id: m.id, role: m.role, content: m.content }));
    const modelForBudget = this.getCurrentModel();
    const triggerInfo = buildContextBudgetInfo({
      config: this.config,
      provider: modelForBudget.activeProvider || modelForBudget.provider,
      model: modelForBudget.activeModel || modelForBudget.model,
      messages: rawHistory
    });

    let history = rawHistory.map((m) => ({ role: m.role, content: m.content }));
    let compactionMeta = null;
    if (this.config.runtime?.contextCompactionEnabled !== false && triggerInfo.overTrigger) {
      const targetTokens = Math.floor(triggerInfo.contextLimit * Number(this.config.runtime?.contextCompactTargetPct || 0.4));
      const compacted = compactSessionMessages({
        messages: rawHistory,
        targetTokens,
        protectRecentTurns: Number(this.config.runtime?.contextProtectRecentTurns || 8)
      });
      history = compacted.compactedMessages;
      if (compacted.cutoffMessageId > 0) {
        const currentModel = `${modelForBudget.activeProvider || modelForBudget.provider}/${modelForBudget.activeModel || modelForBudget.model}`;
        this.memoryStore.recordSessionCompaction({
          sessionId,
          cutoffMessageId: compacted.cutoffMessageId,
          model: currentModel,
          ctxLimit: triggerInfo.contextLimit,
          preTokens: compacted.preTokens,
          postTokens: compacted.postTokens,
          summary: compacted.summary
        });
        this.memoryStore.addMemoryArtifacts(sessionId, compacted.artifacts);
        this.memoryStore.addMessage(sessionId, 'system', compacted.compactedMessages[0]?.content || 'SESSION COMPACTION CHECKPOINT');
      }
      compactionMeta = {
        applied: true,
        preTokens: compacted.preTokens,
        postTokens: compacted.postTokens,
        cutoffMessageId: compacted.cutoffMessageId
      };
    }
    const messages = [
      {
        role: 'system',
        content:
          `You are OpenUnum, an Ubuntu operator agent. Current configured provider/model is ${this.config.model.provider}/${this.config.model.model}. ` +
          'If user asks which model/provider you are using, answer with exactly that runtime value and do not invent other providers.\n' +
          'Never claim an action was completed unless a tool result in this turn confirms it.\n' +
          'For browser tasks: if browser flow is blocked, pivot to terminal/script strategy immediately (curl/wget/git/python/node) and continue.\n' +
          'Prefer the quickest reliable execution path and build short scripts when it improves completion.\n' +
          (routedTools.length ? `Heuristic tool routing hints for this request: ${routedTools.map((item) => `${item.tool}(score=${item.score})`).join(', ')}.\n` : '') +
          `Owner control mode: ${this.config.runtime?.ownerControlMode || 'safe'}. ` +
          'In safe mode, avoid destructive operations without explicit owner approval. ' +
          'In unlocked modes, maximize completion while still requiring tool evidence.\n' +
          'Use tools aggressively to complete tasks end-to-end.\n' +
          (facts ? `Relevant memory:\n${facts}\n` : '') +
          (knowledgeHits ? `Smart memory recall:\n${knowledgeHits}\n` : '') +
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
          sessionId,
          routedTools
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
        routedTools,
        iterations: [],
        failures,
        permissionDenials: [],
        pivotHints: buildPivotHints({
          executedTools: [],
          permissionDenials: [],
          timedOut: false,
          providerFailures: failures
        }),
        turnSummary: {
          toolRuns: 0,
          iterationCount: 0,
          permissionDenials: 0,
          routedTools: routedTools.map((item) => item.tool)
        }
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

    return { sessionId, reply: finalText, model: this.getCurrentModel(), trace, context: { budget: triggerInfo, compaction: compactionMeta } };
  }
}
