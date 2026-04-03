import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildProvider } from '../providers/index.mjs';
import { ToolRuntime } from '../tools/runtime.mjs';
import { loadSkills } from '../skills/loader.mjs';
import { buildContextBudgetInfo, estimateMessagesTokens } from './context-budget.mjs';
import { compactSessionMessages } from './context-compact.mjs';
import {
  classifyControllerBehavior,
  getBehaviorRegistrySnapshot,
  hydrateBehaviorRegistry,
  learnControllerBehavior,
  listBehaviorClasses,
  resetAllLearnedBehaviors,
  resetLearnedBehavior
} from './model-behavior-registry.mjs';
import { buildControllerSystemMessage } from './context-pack-builder.mjs';
import {
  continuationDirective,
  isProofBackedDone,
  recoveryDirective,
  shouldForceContinuation
} from './execution-contract.mjs';
import { resolveExecutionEnvelope } from './model-execution-envelope.mjs';
import {
  classifyProviderFailure,
  resolveFallbackAction,
  shouldUseProvider
} from './provider-fallback-policy.mjs';

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
    url: r.url || null,
    hookEventCount: Array.isArray(r.hookEvents) ? r.hookEvents.length : 0
  };
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function truncateText(text, maxChars = 1600) {
  const clean = stripAnsi(String(text || ''));
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}\n... [truncated ${clean.length - maxChars} chars]`;
}

function compactToolResult(result) {
  const r = result || {};
  const compact = {
    ok: Boolean(r.ok)
  };
  if (Number.isFinite(r.code)) compact.code = r.code;
  if (r.error) compact.error = truncateText(r.error, 400);
  if (r.path || r.outPath) compact.path = r.path || r.outPath;
  if (r.url) compact.url = r.url;
  if (Number.isFinite(r.status)) compact.status = r.status;
  if (r.statusText) compact.statusText = r.statusText;
  if (r.jobId) compact.jobId = r.jobId;
  if (Number.isFinite(r.attempts)) compact.attempts = r.attempts;
  if (r.json != null) compact.json = truncateText(JSON.stringify(r.json), 2000);
  if (r.stdout) compact.stdout = truncateText(r.stdout, 2000);
  if (r.stderr) compact.stderr = truncateText(r.stderr, 1200);
  if (r.text) compact.text = truncateText(r.text, 2000);
  if (Array.isArray(r.hookEvents) && r.hookEvents.length) {
    compact.hookEvents = r.hookEvents.map((item) => ({
      stage: item.stage,
      hook: item.hook,
      decision: item.decision,
      note: truncateText(item.note || '', 120)
    }));
  }
  return compact;
}

function clipText(text, maxChars = 1200) {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3)}...`;
}

function getLastUserMessage(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return String(messages[i].content || '');
  }
  return '';
}

function parseSizeToGiB(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d+(?:\.\d+)?)\s*([tgmk]?i?b)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) return null;
  if (unit.startsWith('tb') || unit.startsWith('tib')) return amount * 1024;
  if (unit.startsWith('gb') || unit.startsWith('gib')) return amount;
  if (unit.startsWith('mb') || unit.startsWith('mib')) return amount / 1024;
  if (unit.startsWith('kb') || unit.startsWith('kib')) return amount / (1024 * 1024);
  return amount;
}

function extractHardwareProfile(executedTools = []) {
  const shell = executedTools
    .filter((run) => run?.name === 'shell_run' && run?.result?.ok)
    .map((run) => String(run?.result?.stdout || ''))
    .join('\n');
  const cpu = shell.match(/Model name:\s*([^\n]+)/i)?.[1]?.trim() || null;
  const threads = Number(shell.match(/CPU\(s\):\s*(\d+)/i)?.[1] || '') || null;
  const ramFromFree = parseSizeToGiB(shell.match(/^Mem:\s+([^\s]+)/im)?.[1] || '');
  const noNvidia = /no nvidia gpu detected/i.test(shell);
  return {
    cpu,
    threads,
    ramGiB: Number.isFinite(ramFromFree) ? ramFromFree : null,
    gpu: noNvidia ? 'none detected' : null
  };
}

function extractModelCandidates(executedTools = []) {
  const rows = [];
  for (const run of executedTools) {
    if (run?.name !== 'http_request' || !run?.result?.ok || !Array.isArray(run?.result?.json)) continue;
    for (const item of run.result.json) {
      const modelId = String(item?.modelId || item?.id || '').trim();
      if (!modelId) continue;
      rows.push({
        modelId,
        downloads: Number(item?.downloads || 0),
        likes: Number(item?.likes || 0),
        private: Boolean(item?.private),
        gated: Boolean(item?.gated),
        pipelineTag: item?.pipeline_tag ? String(item.pipeline_tag) : '',
        tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag)) : []
      });
    }
  }
  const seen = new Set();
  return rows
    .filter((item) => {
      if (!item.modelId || seen.has(item.modelId)) return false;
      seen.add(item.modelId);
      return true;
    })
    .sort((a, b) => {
      const scoreA = (a.downloads * 4) + (a.likes * 25);
      const scoreB = (b.downloads * 4) + (b.likes * 25);
      return scoreB - scoreA;
    });
}

function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function synthesizeToolOnlyAnswer({ userMessage = '', executedTools = [], toolRuns = 0 }) {
  const prompt = String(userMessage || '').toLowerCase();
  const asksModelRanking =
    /model|gguf|ollama|uncensor|local/.test(prompt) &&
    (/top ?5|best|hardware|run/.test(prompt));
  if (asksModelRanking) {
    const hardware = extractHardwareProfile(executedTools);
    const candidates = extractModelCandidates(executedTools)
      .filter((item) => !item.private && !item.gated)
      .slice(0, 5);
    const searchBlocked = executedTools.some((run) => run?.name === 'browser_search' && run?.result?.error === 'model_profile_tool_restricted');
    if (candidates.length) {
      const lines = ['Recovered answer from executed tool evidence.'];
      if (hardware.cpu || hardware.ramGiB || hardware.threads || hardware.gpu) {
        lines.push(
          `Hardware: ${hardware.cpu || 'unknown CPU'} | threads=${hardware.threads || '?'} | RAM≈${hardware.ramGiB ? hardware.ramGiB.toFixed(1) : '?'} GiB | GPU=${hardware.gpu || 'unknown'}`
        );
      }
      lines.push('Top local-model candidates from the current search:');
      for (let i = 0; i < candidates.length; i += 1) {
        const item = candidates[i];
        lines.push(`${i + 1}. ${item.modelId} | downloads=${formatCount(item.downloads)} | likes=${formatCount(item.likes)}`);
      }
      if (hardware.ramGiB && hardware.ramGiB <= 20) {
        lines.push('Machine fit: prioritize 4B-9B quantized GGUFs; treat 18B+ as slow stretch options on this hardware.');
      }
      if (searchBlocked) {
        lines.push('Note: browser search was blocked by the execution profile, so this ranking was recovered from the Hugging Face API response plus the hardware probe.');
      }
      return lines.join('\n');
    }
  }

  if (toolRuns > 0) {
    const recent = executedTools.slice(-4).map((run, idx) => {
      const compact = compactToolResult(run.result);
      return `${idx + 1}. ${run.name} -> ${clipText(JSON.stringify(compact), 360)}`;
    });
    return [
      `Recovered summary from ${toolRuns} tool actions.`,
      'Recent executed actions:',
      ...recent
    ].join('\n');
  }
  return '';
}

function buildSkillPrompt(skills = [], { maxSkills = 4, maxCharsPerSkill = 2000 } = {}) {
  return skills
    .slice(0, maxSkills)
    .map((s) => `Skill ${s.name}:\n${clipText(s.content, maxCharsPerSkill)}`)
    .join('\n\n');
}

function uniqueFacts(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = String(item?.key || '').trim();
    const value = String(item?.value || '').trim();
    if (!key || !value) continue;
    const signature = `${key}=${value}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push({ key, value });
  }
  return out;
}

function extractAutomaticFacts({ message = '', reply = '', model = null, trace = null }) {
  const facts = [];
  const userText = String(message || '').trim();
  const assistantText = String(reply || '').trim();
  const combined = `${userText}\n${assistantText}`;

  const nameMatch =
    userText.match(/\bmy name is\s+([a-z][a-z0-9 .'-]{1,60})/i) ||
    userText.match(/\bcall me\s+([a-z][a-z0-9 .'-]{1,60})/i);
  if (nameMatch?.[1]) facts.push({ key: 'owner.name', value: nameMatch[1].trim() });

  const locationMatch = userText.match(/\bi (?:am|live) in\s+([a-z][a-z0-9 ,.'-]{1,80})/i);
  if (locationMatch?.[1]) facts.push({ key: 'owner.location', value: locationMatch[1].trim() });

  const preferencePatterns = [
    { regex: /\bi prefer\s+([^.\n]{2,80})/i, key: 'owner.preference.general' },
    { regex: /\buse\s+(ollama|openai|openrouter|nvidia)\b/i, key: 'owner.preference.provider' },
    { regex: /\b(?:avoid|don\'t use|do not use)\s+(browser|shell|telegram|email)\b/i, key: 'owner.preference.avoid_surface' }
  ];
  for (const pattern of preferencePatterns) {
    const match = userText.match(pattern.regex);
    if (match?.[1]) facts.push({ key: pattern.key, value: match[1].trim().toLowerCase() });
  }

  const runtimeLabel = providerModelLabel(
    model?.activeProvider || model?.provider,
    model?.activeModel || model?.model
  );
  if (runtimeLabel) facts.push({ key: 'runtime.last_model', value: runtimeLabel });
  if (trace?.executionEnvelope?.tier) facts.push({ key: 'runtime.last_execution_tier', value: String(trace.executionEnvelope.tier) });
  if (trace?.provider) facts.push({ key: 'runtime.last_provider', value: String(trace.provider) });

  const missionStatus = combined.match(/MISSION_STATUS:\s*(DONE|CONTINUE)/i);
  if (missionStatus?.[1]) facts.push({ key: 'runtime.last_mission_status', value: missionStatus[1].toUpperCase() });

  return uniqueFacts(facts);
}

const TOOL_ROUTING_HINTS = [
  { tool: 'session_clear', terms: ['delete all sessions', 'clear all sessions', 'clear chat history', 'wipe sessions'] },
  { tool: 'session_delete', terms: ['delete session', 'remove session'] },
  { tool: 'session_list', terms: ['list sessions', 'show sessions'] },
  { tool: 'file_patch', terms: ['fix ui', 'runtime ui', 'scrollbar', 'overflow', 'fit in container', 'layout fix', 'css fix'] },
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

const EXECUTION_PROFILES = [
  {
    match: ({ provider, model }) => provider === 'ollama' && /kimi|minimax|cloud/.test(model),
    name: 'strict-shell-cloud',
    turnBudgetMs: 60000,
    maxIters: 3,
    guidance: [
      'Use a rigid shell-first workflow with one concrete substep at a time.',
      'Keep tool arguments and conclusions short. Do not rely on long free-form reasoning after large tool output.',
      'After each important tool call, verify state with one short follow-up command before moving on.',
      'When a local or remote service exposes an HTTP API, prefer the `http_request` tool over shelling out to curl.'
    ],
    guardrails: [
      'Prefer deterministic, non-interactive verification surfaces over REPL-style commands or long-running TTY sessions.',
      'Do not spend multiple turns on metadata/blob inspection when a direct proof command is available.',
      'If the same route consumes a full turn without decisive proof, shrink the step or change execution surface.'
    ],
    verificationHints: [
      'For local services, prefer HTTP/JSON endpoints or one-shot CLI invocations over interactive shells when available.',
      'Capture the smallest proof that confirms progress, then move on.'
    ]
  },
  {
    match: ({ provider, model }) => provider === 'ollama' && /qwen|llama|coder|8b|9b|14b/.test(model),
    name: 'local-tool-runner',
    turnBudgetMs: 180000,
    maxIters: 6,
    guidance: [
      'Prefer direct local inspection and execution over browsing.',
      'Use shell to probe hardware, processes, ports, and files before choosing a runtime.',
      'When a long command succeeds, summarize proof and continue immediately.'
    ],
    guardrails: [
      'Avoid interactive CLI loops when a non-interactive API or batch mode exists.',
      'Reuse existing local artifacts and runtimes before creating duplicates.'
    ],
    verificationHints: [
      'Choose verification commands that exit on their own and return compact output.',
      'Use short prompts and bounded context for launch verification.'
    ]
  },
  {
    match: ({ provider }) => provider === 'nvidia' || provider === 'openrouter',
    name: 'structured-api-cloud',
    turnBudgetMs: 90000,
    maxIters: 4,
    guidance: [
      'Work in short verified substeps and keep each turn narrowly scoped.',
      'Prefer direct machine-readable verification over exploratory shell output.',
      'When a local service is being controlled, choose its API surface before interactive CLI flows when both exist.',
      'Prefer the `http_request` tool over `shell_run` with curl for JSON APIs.'
    ],
    guardrails: [
      'Avoid spending turns on low-signal inspection after the correct target is already identified.',
      'If a verification path is interactive or slow, switch to a bounded API or batch route.'
    ],
    verificationHints: [
      'Prefer JSON/HTTP verification surfaces when the target service exposes one.',
      'Keep verification prompts minimal and evidence-focused.'
    ]
  },
  {
    match: ({ provider }) => provider === 'openai',
    name: 'structured-general',
    turnBudgetMs: 120000,
    maxIters: 4,
    guidance: [
      'Think in short verified checkpoints, not long narratives.',
      'Use tools aggressively, but keep each turn scoped to one subgoal with proof.',
      'Prefer `http_request` for API verification instead of `shell_run` with curl.'
    ],
    guardrails: [
      'Prefer high-signal tool calls over repeated introspection.',
      'If a tool output is noisy, extract only the proof and continue.'
    ],
    verificationHints: [
      'Favor stable APIs and single-shot commands for verification.'
    ]
  }
];

function getExecutionProfile(provider, model) {
  const normalized = {
    provider: String(provider || '').trim().toLowerCase(),
    model: String(model || '').trim().toLowerCase()
  };
  const matched = EXECUTION_PROFILES.find((item) => item.match(normalized));
  if (matched) return matched;
  return {
    name: 'default-verified-steps',
    turnBudgetMs: null,
    maxIters: null,
    guidance: [
      'Work in single verified substeps.',
      'Prefer the shortest reliable path.',
      'If a route fails twice, pivot instead of repeating it.',
      'Prefer `http_request` for HTTP/JSON services instead of `shell_run` with curl.'
    ],
    guardrails: [
      'Prefer non-interactive, bounded execution paths over manual or REPL-style flows.',
      'Do not repeat low-value inspection when a direct proof step is available.'
    ],
    verificationHints: [
      'Verify through the most stable machine-readable surface available.'
    ]
  };
}

function mergeProfileWithBehavior(profile, behavior, config) {
  const tuning = behavior?.tuning || {};
  const configuredTurnCap = Number(config?.runtime?.agentTurnTimeoutMs || 420000);
  const profileTurn = Number.isFinite(profile?.turnBudgetMs) ? Number(profile.turnBudgetMs) : null;
  const tuningTurn = Number.isFinite(tuning?.turnBudgetMs) ? Number(tuning.turnBudgetMs) : null;
  let mergedTurnBudget = profileTurn;
  if (mergedTurnBudget == null && tuningTurn != null) mergedTurnBudget = tuningTurn;
  if (mergedTurnBudget != null && tuningTurn != null) mergedTurnBudget = Math.min(mergedTurnBudget, tuningTurn);
  if (mergedTurnBudget != null) {
    mergedTurnBudget = Math.max(20000, Math.min(mergedTurnBudget, configuredTurnCap));
  }

  const profileIters = Number.isFinite(profile?.maxIters) ? Number(profile.maxIters) : null;
  const tuningIters = Number.isFinite(tuning?.maxIters) ? Number(tuning.maxIters) : null;
  let mergedMaxIters = profileIters;
  if (mergedMaxIters == null && tuningIters != null) mergedMaxIters = tuningIters;
  if (mergedMaxIters != null && tuningIters != null) mergedMaxIters = Math.min(mergedMaxIters, tuningIters);
  if (mergedMaxIters != null) {
    mergedMaxIters = Math.max(2, Math.min(mergedMaxIters, 12));
  }

  return {
    ...profile,
    turnBudgetMs: mergedTurnBudget,
    maxIters: mergedMaxIters
  };
}

function detectLocalRuntimeTask(messages = []) {
  const text = messages.map((m) => String(m?.content || '')).join('\n').toLowerCase();
  return /autonomous mission goal|continue autonomous mission/.test(text) &&
    /local|gguf|ollama|llama\.cpp|runtime|launch|server|model/.test(text);
}

function detectUiCodeEditTask(messages = []) {
  const text = messages.map((m) => String(m?.content || '')).join('\n').toLowerCase();
  if (!/ui|frontend|layout|css|html|runtime/.test(text)) return false;
  return /scroll|scrollbar|fit|container|session|chat|sidebar|overflow|panel|view/.test(text);
}

function detectNoScrollbarUiIntent(messages = []) {
  const text = messages.map((m) => String(m?.content || '')).join('\n').toLowerCase();
  if (!/ui|runtime|session|chat|container/.test(text)) return false;
  return /no scrollbar|without scrollbar|remove scrollbar|not to have a scrollbar|overflow/.test(text);
}

function isNonFinalToolMarkupText(text) {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/<\s*minimax:tool_call\b/i.test(trimmed)) return true;
  const hasInvokeBlock = /<\s*invoke\b/i.test(trimmed) && /<\s*parameter\b/i.test(trimmed);
  const hasToolCallTag = /<\s*(tool_call|function_call)\b/i.test(trimmed);
  if (!hasInvokeBlock && !hasToolCallTag) return false;
  const withoutTags = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!withoutTags) return true;
  return /^(invoke|parameter|command|target|name|arguments)\b/i.test(withoutTags);
}

function normalizeAssistantContent(text) {
  if (isNonFinalToolMarkupText(text)) return '';
  return String(text || '');
}

function isDiscoveryShellCommand(cmd) {
  const text = String(cmd || '').trim().toLowerCase();
  if (!text) return false;
  if (/^ls\b|^find\b|^rg\b|^grep\b|^fd\b|^tree\b|^cat\b/.test(text)) return true;
  return /head\s+-\d+|wc\s+-l|sort\b/.test(text);
}

function isLowSignalToolResult(run) {
  if (!run || run.name !== 'shell_run') return false;
  if (!isDiscoveryShellCommand(run.args?.cmd || '')) return false;
  if (!run.result?.ok) return false;
  const stdout = String(run.result?.stdout || '').trim();
  const stderr = String(run.result?.stderr || '').trim();
  return !stdout && !stderr;
}

function isMutatingCodeTool(run) {
  const name = String(run?.name || '').trim();
  return name === 'file_patch' || name === 'file_write';
}

function isUiInspectionTool(run) {
  const name = String(run?.name || '').trim();
  if (name === 'file_read') {
    const path = String(run?.args?.path || '').replace(/\\/g, '/');
    return path.endsWith('/src/ui/index.html') || path === 'src/ui/index.html';
  }
  if (name !== 'shell_run') return false;
  const cmd = String(run?.args?.cmd || '').toLowerCase();
  return cmd.includes('src/ui/index.html') && /grep|sed|cat|head|tail|find|ls/.test(cmd);
}

function touchedUiSourceFile(run) {
  const name = String(run?.name || '').trim();
  if (!['file_read', 'file_patch', 'file_write'].includes(name)) return false;
  const path = String(run?.args?.path || '').replace(/\\/g, '/');
  return path.endsWith('/src/ui/index.html') || path === 'src/ui/index.html' || path === './src/ui/index.html';
}

function applyNoScrollbarUiFix(workspaceRoot) {
  const targetPath = `${String(workspaceRoot || '').replace(/\/+$/, '')}/src/ui/index.html`;
  if (!fs.existsSync(targetPath)) {
    return { ok: false, error: 'ui_file_not_found', path: targetPath };
  }
  const original = fs.readFileSync(targetPath, 'utf8');
  const findBlock = [
    '.sessions-list {',
    '      display: grid;',
    '      gap: 6px;',
    '      max-height: 42vh;',
    '      overflow: auto;',
    '      padding: 8px;',
    '    }'
  ].join('\n');
  const replaceBlock = [
    '.sessions-list {',
    '      display: grid;',
    '      gap: 6px;',
    '      max-height: none;',
    '      overflow: hidden;',
    '      padding: 8px;',
    '    }'
  ].join('\n');
  let updated = original;
  if (updated.includes(findBlock)) {
    updated = updated.replace(findBlock, replaceBlock);
  } else {
    updated = updated
      .replace(/max-height:\s*42vh;\s*/g, 'max-height: none;\n      ')
      .replace(/overflow:\s*auto;\s*/g, 'overflow: hidden;\n      ');
  }
  if (updated === original) {
    return { ok: true, path: targetPath, changed: false };
  }
  fs.writeFileSync(targetPath, updated, 'utf8');
  return { ok: true, path: targetPath, changed: true };
}

export class OpenUnumAgent {
  constructor({ config, memoryStore }) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.toolRuntime = new ToolRuntime(config, memoryStore);
    this.behaviorRegistryHydrated = false;
    if (this.memoryStore?.listControllerBehaviors) {
      const persisted = this.memoryStore.listControllerBehaviors(200);
      hydrateBehaviorRegistry(persisted);
      this.behaviorRegistryHydrated = true;
    }
    this.lastRuntime = {
      provider: config.model.provider,
      model: config.model.model
    };
    this.providerAvailability = new Map();
  }

  getCurrentModel() {
    return {
      provider: this.config.model.provider,
      model: this.config.model.model,
      activeProvider: this.lastRuntime?.provider || this.config.model.provider,
      activeModel: this.lastRuntime?.model || this.config.model.model
    };
  }

  getControllerBehaviorSnapshot(limit = 40) {
    const inMemory = getBehaviorRegistrySnapshot(limit);
    const persisted = this.memoryStore?.listControllerBehaviors
      ? this.memoryStore.listControllerBehaviors(limit)
      : [];
    return {
      hydrated: this.behaviorRegistryHydrated,
      inMemory,
      persisted
    };
  }

  getBehaviorClasses() {
    return listBehaviorClasses();
  }

  resetControllerBehavior({ provider, model } = {}) {
    const p = String(provider || '').trim().toLowerCase();
    const m = String(model || '').trim().toLowerCase();
    const runtime = resetLearnedBehavior({ provider: p, model: m });
    const persistedRemoved = this.memoryStore?.removeControllerBehavior
      ? this.memoryStore.removeControllerBehavior({ provider: p, model: m })
      : { ok: false, removed: false };
    return {
      ok: Boolean(runtime?.ok),
      provider: p,
      model: m,
      runtimeRemoved: Boolean(runtime?.removed),
      persistedRemoved: Boolean(persistedRemoved?.removed)
    };
  }

  resetAllControllerBehaviors() {
    const runtime = resetAllLearnedBehaviors();
    const persisted = this.memoryStore?.clearControllerBehaviors
      ? this.memoryStore.clearControllerBehaviors()
      : { ok: false, removedCount: 0 };
    return {
      ok: Boolean(runtime?.ok),
      runtimeRemovedCount: Number(runtime?.removedCount || 0),
      persistedRemovedCount: Number(persisted?.removedCount || 0)
    };
  }

  getProviderAvailabilitySnapshot() {
    const now = Date.now();
    return [...this.providerAvailability.entries()].map(([provider, row]) => {
      const blockedUntil = Number(row?.blockedUntil || 0);
      return {
        provider,
        blockedUntil,
        blockedUntilIso: blockedUntil ? new Date(blockedUntil).toISOString() : null,
        blocked: blockedUntil > now,
        lastFailureKind: row?.lastFailureKind || null,
        lastAction: row?.lastAction || null,
        lastError: row?.lastError || null,
        updatedAt: row?.updatedAt || null
      };
    });
  }

  markProviderFailure(provider, { kind, action, cooldownMs = 0, errorMessage = '' } = {}) {
    const now = Date.now();
    const blockedUntil = cooldownMs > 0 ? now + Number(cooldownMs) : 0;
    this.providerAvailability.set(provider, {
      blockedUntil,
      lastFailureKind: kind || 'unknown',
      lastAction: action || 'switch_provider',
      lastError: String(errorMessage || '').slice(0, 500),
      updatedAt: new Date(now).toISOString()
    });
  }

  clearProviderFailure(provider) {
    if (!this.providerAvailability.has(provider)) return;
    this.providerAvailability.set(provider, {
      blockedUntil: 0,
      lastFailureKind: null,
      lastAction: 'success',
      lastError: null,
      updatedAt: new Date().toISOString()
    });
  }

  switchModel(provider, model) {
    provider = String(provider || 'ollama').trim().toLowerCase() === 'generic' ? 'openai' : String(provider || 'ollama').trim().toLowerCase();
    this.config.model.provider = provider;
    this.config.model.model = providerModelLabel(provider, model);
    this.config.model.providerModels = this.config.model.providerModels || {};
    this.config.model.providerModels[provider] = this.config.model.model;
    return this.getCurrentModel();
  }

  async runTool(name, args, context = {}) {
    return this.toolRuntime.run(name, args || {}, context || {});
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
        '/session list',
        '/session clear',
        '/session delete <id>'
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
    if (slash.name === 'session' && slash.args[0] === 'clear') {
      const out = this.memoryStore.clearSessions({ keepSessionId: sid });
      return [
        `session_clear ok=${out.ok}`,
        `keep_session_id=${sid}`,
        `deleted_sessions=${out.deletedSessions}`,
        `deleted_messages=${out.deletedMessages}`
      ].join('\n');
    }
    if (slash.name === 'session' && slash.args[0] === 'delete') {
      const targetId = String(slash.args[1] || '').trim();
      if (!targetId) return 'usage: /session delete <sessionId>';
      if (targetId === sid) return 'refused: cannot delete the active session via slash command.';
      const out = this.memoryStore.deleteSession(targetId);
      return [
        `session_delete ok=${out.ok}`,
        `session_id=${targetId}`,
        `deleted=${out.deleted}`,
        `deleted_messages=${out.deletedMessages}`
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
    const now = Date.now();
    let selected = providers.filter((provider) => shouldUseProvider(this.providerAvailability.get(provider), now));
    if (!selected.length) selected = [preferred];
    return selected.map((provider) => ({
      provider,
      model: provider === preferred ? this.config.model.model : this.getModelForProvider(provider)
    }));
  }

  async runOneProviderTurn({
    provider,
    model,
    messages,
    sessionId,
    routedTools = [],
    contextPackInputs = {}
  }) {
    const originalUserMessage = getLastUserMessage(messages);
    const executionEnvelope = resolveExecutionEnvelope({
      provider,
      model,
      runtime: this.config.runtime
    });
    const behavior = classifyControllerBehavior({ provider, model, config: this.config });
    const executionProfile = mergeProfileWithBehavior(getExecutionProfile(provider, model), behavior, this.config);
    const localRuntimeTask = detectLocalRuntimeTask(messages);
    const uiCodeEditTask = detectUiCodeEditTask(messages);
    const noScrollbarUiIntent = detectNoScrollbarUiIntent(messages);
    const attemptConfig = {
      ...this.config,
      model: {
        ...this.config.model,
        provider,
        model
      }
    };
    const runtimeProvider = buildProvider(attemptConfig);
    messages = [
      {
        role: 'system',
        content: buildControllerSystemMessage({
          config: this.config,
          executionProfile,
          behavior,
          provider,
          model,
          routedTools,
          ...contextPackInputs
        })
      },
      ...messages
    ];
    const baseMaxIters = executionProfile.maxIters || this.config.runtime?.maxToolIterations || 4;
    const uiRaisedBaseMaxIters = uiCodeEditTask && !executionEnvelope.verySmallModel ? Math.max(baseMaxIters, 6) : baseMaxIters;
    const envelopeMaxIters = executionEnvelope.maxToolIterations || this.config.runtime?.maxToolIterations || 4;
    const uiRaisedEnvelopeMaxIters = uiCodeEditTask && !executionEnvelope.verySmallModel ? Math.max(envelopeMaxIters, 6) : envelopeMaxIters;
    const maxIters = Math.max(
      1,
      Math.min(
        uiRaisedBaseMaxIters,
        uiRaisedEnvelopeMaxIters
      )
    );
    const baseTurnBudgetMs = executionProfile.turnBudgetMs || this.config.runtime?.agentTurnTimeoutMs || 420000;
    const isCloudController = ['nvidia', 'openrouter', 'openai'].includes(String(provider || '').toLowerCase()) ||
      (String(provider || '').toLowerCase() === 'ollama' && /cloud/.test(String(model || '').toLowerCase()));
    const turnBudgetMs = localRuntimeTask && !isCloudController
      ? Math.max(baseTurnBudgetMs, 180000)
      : uiCodeEditTask && !isCloudController
        ? Math.max(baseTurnBudgetMs, 120000)
        : baseTurnBudgetMs;
    const turnStartedAt = Date.now();
    const uiEditTools = ['file_read', 'file_patch', 'file_write', 'file_restore_last'];
    const turnToolAllowlist = uiCodeEditTask
      ? (Array.isArray(executionEnvelope.toolAllowlist) && executionEnvelope.toolAllowlist.length
        ? uiEditTools.filter((name) => executionEnvelope.toolAllowlist.includes(name))
        : uiEditTools)
      : executionEnvelope.toolAllowlist;
    let finalText = '';
    let toolRuns = 0;
    const executedTools = [];
    const trace = {
      provider,
      model,
      executionProfile: executionProfile.name,
      behaviorClass: behavior.classId,
      behaviorConfidence: behavior.confidence,
      behaviorSource: behavior.source,
      localRuntimeTask,
      uiCodeEditTask,
      executionEnvelope,
      routedTools,
      iterations: [],
      recoveryUsed: false,
      permissionDenials: [],
      toolStateTransitions: [],
      lowSignalPivotUsed: false
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
        tools: this.toolRuntime.toolSchemas({ allowedTools: turnToolAllowlist }),
        timeoutMs: remainingMs
      });
      const normalizedContent = normalizeAssistantContent(out.content);
      const iter = {
        step: i + 1,
        toolCalls: [],
        assistantText: normalizedContent || ''
      };
      if (normalizedContent || (out.toolCalls && out.toolCalls.length > 0)) {
        finalText = normalizedContent;
        const assistantMessage = {
          role: 'assistant',
          content: normalizedContent || ''
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
        const forceContinue = shouldForceContinuation({
          assistantText: normalizedContent || finalText,
          toolCalls: out.toolCalls,
          toolRuns,
          iteration: i + 1,
          maxIters,
          priorForcedCount: forcedContinueCount
        });
        if (forceContinue) {
          forcedContinueCount += 1;
          messages.push({
            role: 'system',
            content: continuationDirective('planner_without_proof')
          });
          continue;
        }
        break;
      }

      for (const tc of out.toolCalls) {
        trace.toolStateTransitions.push({
          at: new Date().toISOString(),
          tool: tc.name,
          state: 'scheduled',
          step: i + 1
        });
        const toolRemainingMs = turnBudgetMs - (Date.now() - turnStartedAt);
        if (toolRemainingMs <= 0) {
          trace.timedOut = true;
          trace.timeoutMs = turnBudgetMs;
          break;
        }
        const args = parseToolArgs(tc.arguments);
        if (uiCodeEditTask && tc.name === 'file_read') {
          const current = String(args.path || '').replace(/\\/g, '/');
          const valid = current === 'src/ui/index.html' || current === './src/ui/index.html' || current.endsWith('/src/ui/index.html');
          if (!valid) {
            args.path = 'src/ui/index.html';
          }
        }
        if (uiCodeEditTask && (tc.name === 'file_patch' || tc.name === 'file_write') && !String(args.path || '').trim()) {
          args.path = 'src/ui/index.html';
        }

        let result;
        try {
          trace.toolStateTransitions.push({
            at: new Date().toISOString(),
            tool: tc.name,
            state: 'executing',
            step: i + 1
          });
          result = await this.toolRuntime.run(tc.name, args, {
            sessionId,
            deadlineAt: turnStartedAt + turnBudgetMs,
            allowedTools: turnToolAllowlist,
            policyMode: this.config?.runtime?.autonomyPolicy?.mode || 'execute'
          });
        } catch (error) {
          result = { ok: false, error: String(error.message || error) };
        }
        trace.toolStateTransitions.push({
          at: new Date().toISOString(),
          tool: tc.name,
          state: result?.ok ? 'success' : 'error',
          step: i + 1,
          reason: result?.error || ''
        });
        if (!result?.ok && ['shell_blocked', 'owner_mode_restricted', 'tool_circuit_open', 'shell_disabled', 'unsafe_xdotool_command'].includes(result?.error)) {
          trace.permissionDenials.push({
            tool: tc.name,
            reason: result.error,
            detail: result.stderr || result.error
          });
        }
        toolRuns += 1;
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
          content: JSON.stringify(compactToolResult(result))
        });
      }
      trace.iterations.push(iter);
      const stepRuns = executedTools.slice(-iter.toolCalls.length);
      const lowSignalDiscovery = stepRuns.length > 0 && stepRuns.every((run) => isLowSignalToolResult(run));
      if (uiCodeEditTask && lowSignalDiscovery && (i + 1) < maxIters) {
        trace.lowSignalPivotUsed = true;
        messages.push({
          role: 'system',
          content: [
            continuationDirective('empty_discovery_pivot_ui'),
            'Pivot immediately: do not run more broad filesystem discovery.',
            'Next concrete action must be `file_read` for `src/ui/index.html`.',
            'After reading, patch only the minimal CSS/markup needed to remove runtime sessions overflow.'
          ].join('\n')
        });
      }
      const hasCodeMutation = executedTools.some((run) => isMutatingCodeTool(run));
      const touchedUiFile = executedTools.some((run) => touchedUiSourceFile(run));
      if (uiCodeEditTask && !touchedUiFile && !hasCodeMutation && (i + 1) < maxIters) {
        messages.push({
          role: 'system',
          content: [
            continuationDirective('ui_target_file_required'),
            'UI task target is exactly `src/ui/index.html`.',
            'Next action must be `file_read` with path `src/ui/index.html`.',
            'Do not read directories or unrelated files.'
          ].join('\n')
        });
      }
      const uiInspectionOnlyStep = stepRuns.length > 0 && stepRuns.every((run) => isUiInspectionTool(run));
      if (uiCodeEditTask && touchedUiFile && !hasCodeMutation && uiInspectionOnlyStep && (i + 1) < maxIters) {
        messages.push({
          role: 'system',
          content: [
            continuationDirective('ui_edit_required_after_inspection'),
            'You have already inspected the relevant UI file.',
            'Next action must be a concrete edit via `file_patch` or `file_write` on `src/ui/index.html`.',
            'After the edit, provide a concise final status and include what was changed.'
          ].join('\n')
        });
      }
      if (trace.timedOut) break;
    }

    if (!finalText && toolRuns > 0) {
      try {
        trace.recoveryUsed = true;
        const remainingMs = turnBudgetMs - (Date.now() - turnStartedAt);
        if (remainingMs <= 0) {
          trace.timedOut = true;
          trace.timeoutMs = turnBudgetMs;
          throw new Error('turn_deadline_exceeded');
        }
        const recoveryMessages = [
          ...messages,
          {
            role: 'system',
            content: recoveryDirective()
          }
        ];
        const recovery = await runtimeProvider.chat({ messages: recoveryMessages, tools: [], timeoutMs: remainingMs });
        if (recovery?.content) {
          const normalizedRecoveryContent = normalizeAssistantContent(recovery.content);
          if (normalizedRecoveryContent) {
            finalText = normalizedRecoveryContent;
          }
        }
      } catch {
        // ignore and fallback to synthesized summary below
      }
    }

    if (!finalText && uiCodeEditTask && toolRuns > 0 && !noScrollbarUiIntent) {
      const hasCodeMutation = executedTools.some((run) => isMutatingCodeTool(run));
      const inspectedUi = executedTools.some((run) => isUiInspectionTool(run));
      if (inspectedUi && !hasCodeMutation) {
        finalText = [
          'UI task did not complete: inspection ran, but no UI edit was applied.',
          'Status: NOT DONE',
          'Required next action: patch `src/ui/index.html` to remove sessions-panel overflow/scrollbar and keep content fitting its container.'
        ].join('\n');
      }
    }

    if (!finalText && uiCodeEditTask && noScrollbarUiIntent) {
      const hasCodeMutation = executedTools.some((run) => isMutatingCodeTool(run));
      if (!hasCodeMutation) {
        const autoFix = applyNoScrollbarUiFix(this.config?.runtime?.workspaceRoot || process.cwd());
        if (autoFix.ok) {
          finalText = [
            'Applied deterministic UI recovery because model did not emit a concrete edit.',
            `Auto-fix target: ${autoFix.path}`,
            `Changed: ${Boolean(autoFix.changed)}`,
            'Status: DONE'
          ].join('\n');
        }
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

    if (
      finalText &&
      behavior?.tuning?.requireProofForDone &&
      !isProofBackedDone({ text: finalText, toolRuns, requireProofForDone: true }) &&
      /mission_status:\s*done/i.test(String(finalText))
    ) {
      finalText = [
        'Completion claim was rejected by execution contract: no proof-backed tool evidence in this turn.',
        'MISSION_STATUS: CONTINUE'
      ].join('\n');
    }

    if (!finalText && toolRuns > 0) {
      finalText = synthesizeToolOnlyAnswer({
        userMessage: originalUserMessage,
        executedTools,
        toolRuns
      });
      if (!finalText) {
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
    const learned = learnControllerBehavior({ provider, model, trace });
    if (learned && this.memoryStore?.upsertControllerBehavior) {
      this.memoryStore.upsertControllerBehavior({
        provider: learned.provider,
        model: learned.model,
        classId: learned.classId,
        sampleCount: learned.sampleCount,
        reasons: learned.reasons
      });
    }
    return { finalText, trace };
  }

  async chat({ message, sessionId = crypto.randomUUID() }) {
    const slash = parseSlashCommand(message);
    if (slash) {
      const slashReply = this.handleSlashCommand(sessionId, slash);
      if (slashReply) {
        this.memoryStore.addMessage(sessionId, 'user', message);
        this.memoryStore.addMessage(sessionId, 'assistant', slashReply);
        for (const fact of extractAutomaticFacts({
          message,
          reply: slashReply,
          model: this.getCurrentModel(),
          trace: null
        })) {
          this.memoryStore.rememberFact(fact.key, fact.value);
        }
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
        'Context window: not guaranteed from runtime config; provider metadata endpoint is the source of truth.',
        `Execution tier: ${resolveExecutionEnvelope({
          provider: this.lastRuntime?.provider || this.config.model.provider,
          model: this.lastRuntime?.model || this.config.model.model,
          runtime: this.config.runtime
        }).tier}`
      ].join('\n');
      this.memoryStore.addMessage(sessionId, 'user', message);
      this.memoryStore.addMessage(sessionId, 'assistant', reply);
      for (const fact of extractAutomaticFacts({
        message,
        reply,
        model: this.getCurrentModel(),
        trace: null
      })) {
        this.memoryStore.rememberFact(fact.key, fact.value);
      }
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

    const modelForBudget = this.getCurrentModel();
    const sessionEnvelope = resolveExecutionEnvelope({
      provider: modelForBudget.activeProvider || modelForBudget.provider,
      model: modelForBudget.activeModel || modelForBudget.model,
      runtime: this.config.runtime
    });
    const compactController = Boolean(sessionEnvelope.verySmallModel);
    const strategyHints = this.memoryStore.retrieveStrategyHintsSmart
      ? this.memoryStore.retrieveStrategyHintsSmart(message, compactController ? 3 : 6)
      : this.memoryStore.retrieveStrategyHints(message, compactController ? 2 : 4);
    const strategyPrompt = strategyHints.length
      ? strategyHints
        .map((s, idx) => `${idx + 1}. ${s.success ? 'SUCCESS' : 'FAIL'} | ${clipText(s.strategy, compactController ? 80 : 180)} | ${clipText(s.evidence, compactController ? 120 : 220)}`)
        .join('\n')
      : '';

    const facts = this.memoryStore.retrieveFacts(message, compactController ? 3 : 5)
      .map((f) => `${f.key}: ${clipText(f.value, compactController ? 80 : 160)}`)
      .join('\n');
    const knowledgeHits = !compactController && this.memoryStore.searchKnowledge
      ? this.memoryStore.searchKnowledge(message, 6).map((k, idx) => `${idx + 1}. [${k.type}] ${clipText(k.text, 180)}`).join('\n')
      : '';
    const skillPrompt = buildSkillPrompt(
      skills,
      compactController
        ? { maxSkills: 1, maxCharsPerSkill: 500 }
        : { maxSkills: 4, maxCharsPerSkill: 2000 }
    );
    const historyLimit = Number.isFinite(sessionEnvelope.maxHistoryMessages) ? Number(sessionEnvelope.maxHistoryMessages) : 1200;
    const rawHistory = this.memoryStore.getMessagesForContext(sessionId, historyLimit)
      .map((m) => ({ id: m.id, role: m.role, content: m.content }));
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
    const contextPackInputs = {
      routedTools,
      facts,
      knowledgeHits,
      strategyPrompt,
      skillPrompt,
      executionEnvelope: sessionEnvelope
    };

    const messages = [
      {
        role: 'system',
        content:
          `You are OpenUnum, an Ubuntu operator agent. Current configured provider/model is ${this.config.model.provider}/${this.config.model.model}. ` +
          'If user asks which model/provider you are using, answer with exactly that runtime value and do not invent other providers.\n' +
          'Never claim an action was completed unless a tool result in this turn confirms it.\n' +
          `Execution contract for every model: work in small proof-backed substeps and pivot after repeated route failure.${compactController ? ' Compact local mode is active: keep replies short and avoid broad exploration.\n' : '\n'}` +
          `Owner control mode: ${this.config.runtime?.ownerControlMode || 'safe'}. ` +
          'In safe mode, avoid destructive operations without explicit owner approval. ' +
          'In unlocked modes, maximize completion while still requiring tool evidence.\n' +
          'Use tools aggressively to complete tasks end-to-end.\n'
      },
      ...history
    ];

    let finalText = '';
    const attempts = this.buildProviderAttempts();
    const failures = [];
    let trace = null;

    for (const attempt of attempts) {
      let attemptNo = 0;
      while (attemptNo < 2) {
        attemptNo += 1;
        try {
          const run = await this.runOneProviderTurn({
            provider: attempt.provider,
            model: attempt.model,
            messages: [...messages],
            sessionId,
            routedTools,
            contextPackInputs
          });
          this.clearProviderFailure(attempt.provider);
          finalText = run.finalText;
          trace = run.trace;
          if (failures.length) trace.providerFailures = [...failures];
          break;
        } catch (error) {
          const errorMessage = String(error.message || error);
          const kind = classifyProviderFailure(error);
          const decision = resolveFallbackAction(kind, attemptNo);
          this.markProviderFailure(attempt.provider, {
            kind,
            action: decision.action,
            cooldownMs: decision.cooldownMs,
            errorMessage
          });
          failures.push({
            provider: attempt.provider,
            model: attempt.model,
            attempt: attemptNo,
            kind,
            action: decision.action,
            cooldownMs: decision.cooldownMs,
            error: errorMessage
          });
          if (decision.action === 'retry_same_provider' && attemptNo < 2) continue;
          break;
        }
      }
      if (finalText) break;
    }

    const failureLines = failures.map((item) =>
      `${item.provider}: kind=${item.kind} action=${item.action} error=${item.error}`
    );

    if (!finalText) {
      finalText = `All configured providers failed.\n${failureLines.join('\n')}`;
      trace = {
        provider: this.config.model.provider,
        model: this.config.model.model,
        routedTools,
        iterations: [],
        failures: failureLines,
        providerFailures: failures,
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
    for (const fact of extractAutomaticFacts({
      message,
      reply: finalText,
      model: this.getCurrentModel(),
      trace
    })) {
      this.memoryStore.rememberFact(fact.key, fact.value);
    }

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
