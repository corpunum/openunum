import { suggestAlternatives } from './alternative-paths.mjs';

export function inferParamsB(modelId) {
  const m = String(modelId || '').toLowerCase().match(/(\d+(?:\.\d+)?)b/);
  return m ? Number(m[1]) : null;
}

export function isModelInfoQuestion(text) {
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

export function normalizeModelForProvider(provider, model) {
  const providerRaw = String(provider || 'ollama-cloud').trim().toLowerCase();
  const normalizedProvider = providerRaw === 'generic' ? 'openai' : (providerRaw === 'ollama' ? 'ollama-cloud' : providerRaw);
  const raw = String(model || '').replace(/^(ollama-local|ollama-cloud|ollama|openrouter|nvidia|xiaomimimo|generic|openai)\//, '');
  return `${normalizedProvider}/${raw}`;
}

export function providerModelLabel(provider, model) {
  const rawProvider = String(provider || '').trim().toLowerCase();
  const p = rawProvider === 'generic' ? 'openai' : (rawProvider === 'ollama' ? 'ollama-cloud' : rawProvider);
  const m = String(model || '').trim();
  if (!p) return m;
  if (!m) return p;
  if (m.startsWith(`${p}/`)) return m;
  if (/^(ollama-local|ollama-cloud|ollama|openrouter|nvidia|xiaomimimo|generic|openai)\//.test(m)) {
    return m.replace(/^generic\//, 'openai/').replace(/^ollama\//, `${p}/`);
  }
  return `${p}/${m}`;
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function parseToolArgs(rawArgs) {
  if (rawArgs == null) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  if (typeof rawArgs !== 'string') return {};
  try {
    return JSON.parse(rawArgs || '{}');
  } catch {
    return {};
  }
}

export function summarizeResult(result) {
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

export function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

export function truncateText(text, maxChars = 1600) {
  const clean = stripAnsi(String(text || ''));
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}\n... [truncated ${clean.length - maxChars} chars]`;
}

export function compactToolResult(result) {
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
  if (Array.isArray(r.results)) {
    compact.results = r.results
      .slice(0, 6)
      .map((item) => ({
        title: truncateText(item?.title || '', 180),
        url: truncateText(item?.url || '', 300),
        snippet: truncateText(item?.snippet || '', 260)
      }));
  }
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

export function clipText(text, maxChars = 1200) {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3)}...`;
}

export function getLastUserMessage(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return String(messages[i].content || '');
  }
  return '';
}

export function buildSkillPrompt(skills = [], { maxSkills = 4, maxCharsPerSkill = 2000 } = {}) {
  return skills
    .slice(0, maxSkills)
    .map((s) => `Skill ${s.name}:\n${clipText(s.content, maxCharsPerSkill)}`)
    .join('\n\n');
}

export function uniqueFacts(items = []) {
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

export function extractAutomaticFacts({ message = '', reply = '', model = null, trace = null }) {
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
    { regex: /\buse\s+(ollama|ollama-local|ollama-cloud|openai|openrouter|nvidia|xiaomimimo)\b/i, key: 'owner.preference.provider' },
    { regex: /\b(?:avoid|don't use|do not use)\s+(browser|shell|telegram|email)\b/i, key: 'owner.preference.avoid_surface' }
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

export function inferRoutedTools(message) {
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

export function parseSlashCommand(message) {
  const text = String(message || '').trim();
  if (!text.startsWith('/')) return null;
  const [command, ...rest] = text.slice(1).split(/\s+/);
  return {
    name: String(command || '').toLowerCase(),
    args: rest,
    raw: text
  };
}

export function buildPivotHints({ executedTools = [], permissionDenials = [], timedOut = false, providerFailures = [] }) {
  const hints = [];
  const failedTools = executedTools.filter((item) => item?.result?.ok === false);
  const repeatedFailures = new Map();
  for (const item of failedTools) {
    repeatedFailures.set(item.name, (repeatedFailures.get(item.name) || 0) + 1);
  }

  if (permissionDenials.some((item) => String(item.tool || '').includes('browser'))) {
    hints.push('Browser path was blocked. Pivot to terminal or script execution immediately.');
  }

  const errorTools = executedTools.filter((t) => t.error || t.reason);
  for (const ft of errorTools) {
    const alt = suggestAlternatives(ft.tool, ft.error || ft.reason);
    if (alt.length) hints.push(`Alternatives for ${ft.tool}: ${alt.join(', ')}`);
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
    match: ({ provider, model }) => (provider === 'ollama-cloud' || provider === 'ollama') && /kimi|minimax|cloud/.test(model),
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
    match: ({ provider, model }) => provider === 'ollama-local' || ((provider === 'ollama-cloud' || provider === 'ollama') && /qwen|llama|coder|8b|9b|14b/.test(model)),
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

export function getExecutionProfile(provider, model) {
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

export function mergeProfileWithBehavior(profile, behavior, config) {
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

export function detectLocalRuntimeTask(messages = []) {
  const text = messages.map((m) => String(m?.content || '')).join('\n').toLowerCase();
  return /autonomous mission goal|continue autonomous mission/.test(text) &&
    /local|gguf|ollama|llama\.cpp|runtime|launch|server|model/.test(text);
}

export function isNonFinalToolMarkupText(text) {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/<\s*minimax:tool_call\b/i.test(trimmed)) return true;
  const hasInvokeBlock = /<\s*invoke\b/i.test(trimmed) && /<\s*parameter\b/i.test(trimmed);
  const hasToolCallTag = /<\s*(tool_call|function_call)\b/i.test(trimmed);
  if (hasToolCallTag) return true;
  if (!hasInvokeBlock && !hasToolCallTag) return false;
  const withoutTags = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!withoutTags) return true;
  return /^(invoke|parameter|command|target|name|arguments)\b/i.test(withoutTags);
}

export function normalizeAssistantContent(text) {
  if (isNonFinalToolMarkupText(text)) return '';
  return String(text || '');
}

export function toolRunFailed(result) {
  if (!result || typeof result !== 'object') return true;
  if (result.ok === false) return true;
  if (typeof result.error === 'string' && result.error.trim()) return true;
  return false;
}

export function deterministicGreetingReply(message) {
  const text = String(message || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^good morning\b/.test(text)) return 'Good morning. How can I help?';
  if (/^good afternoon\b/.test(text)) return 'Good afternoon. How can I help?';
  if (/^good evening\b/.test(text)) return 'Good evening. How can I help?';
  if (/^(hi|hello|hey|yo|greetings)\b/.test(text)) return 'Hello. How can I help?';
  return '';
}

export function deterministicLightChatReply() {
  return 'Ready. Tell me what you want to do next.';
}

export function scoreDeterministicFastTurn(text) {
  const raw = String(text || '').toLowerCase().trim();
  if (!raw) return 0;
  const normalized = raw.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 8 || normalized.length > 72) return 0;
  const hasTaskSignal = /\b(what|how|why|where|when|which|who|can you|please|show|list|check|fix|create|build|run|install|open|search|find|write|read|explain|configure|debug|error|trace|stack|app|runtime|model|provider|continue|proceed|next|keep going|go on|grep|file|files|web|latest|news|today|current)\b/.test(normalized);
  const hasCodeLike = /[\\/`$={}[\]<>]/.test(raw) || /\d{2,}/.test(raw);
  let score = 0;
  if (words.length <= 3) score += 0.45;
  else if (words.length <= 5) score += 0.3;
  else if (words.length <= 8) score += 0.1;
  if (normalized.length <= 24) score += 0.25;
  else if (normalized.length <= 40) score += 0.12;
  if (!hasTaskSignal) score += 0.2;
  if (!hasCodeLike) score += 0.15;
  if (hasTaskSignal) score -= 0.9;
  if (hasCodeLike) score -= 0.7;
  return Math.max(0, Math.min(1, score));
}

export function isConversationalAliveQuestion(text) {
  const t = String(text || '').toLowerCase().trim();
  const alivePatterns = [
    /^so you are alive\??$/,
    /^are you (dead|alive)\??$/,
    /^are you dead or alive\??$/,
    /^so you are dead\??$/,
    /.*\balive\b.*\?$/,
    /.*\bdead\b.*\?$/
  ];

  const technicalPatterns = [
    'health', 'status', 'check', 'diagnose', 'monitor', 'debug', 'test', 'verify'
  ];

  const hasTechnicalTerms = technicalPatterns.some(term => t.includes(term));

  if (hasTechnicalTerms) {
    return false;
  }

  return alivePatterns.some(pattern => pattern.test(t));
}
