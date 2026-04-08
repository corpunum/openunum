const PROVIDER_PREFIXES = [
  'ollama-local',
  'ollama-cloud',
  'ollama',
  'openrouter',
  'nvidia',
  'xiaomimimo',
  'generic',
  'openai'
];

export const pendingPollDelayMs = (pollCount = 0) => {
  const n = Number(pollCount) || 0;
  if (n <= 1) return 700;
  if (n <= 3) return 1000;
  if (n <= 7) return 1400;
  return 1800;
};

export function chatFastAckTimeoutMs(message, options = {}) {
  const raw = String(message || '');
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return 5000;

  const words = normalized.split(' ').filter(Boolean);
  const chars = normalized.length;
  const punctuation = (normalized.match(/[?!.:,;]/g) || []).length;
  const lineBreaks = (raw.match(/\n/g) || []).length;
  const hasCodeLike = /[`{}[\]<>$\\/]/.test(raw) || /\b(src|api|model|provider|error|trace|stack|test|fix|debug)\b/.test(normalized);
  const hasPathLike = /\/[a-z0-9._-]+/i.test(raw) || /[a-z]:\\/i.test(raw);
  const recentUserTurns = Math.max(0, Number(options?.recentUserTurns) || 0);

  let complexity = 0;
  complexity += Math.min(words.length, 32) * 0.25;
  complexity += Math.min(chars, 300) / 90;
  complexity += Math.min(punctuation, 8) * 0.2;
  complexity += Math.min(lineBreaks, 8) * 0.5;
  complexity += hasCodeLike ? 1.2 : 0;
  complexity += hasPathLike ? 1.0 : 0;
  complexity += recentUserTurns >= 8 ? 0.8 : 0;

  if (complexity <= 1.4) return 3500;
  if (complexity <= 2.4) return 5000;
  if (complexity <= 3.6) return 7000;
  if (complexity <= 5.2) return 9000;
  return 12000;
}

export function formatRelativeTime(iso) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(t).toLocaleDateString();
}

export function newestAssistantSince(messages, sinceIso) {
  const sinceMs = Date.parse(sinceIso || '') || 0;
  let candidate = null;
  for (const m of (messages || [])) {
    if (m.role !== 'assistant') continue;
    const t = Date.parse(m.created_at || '');
    if (Number.isFinite(t) && t >= sinceMs) candidate = m;
  }
  return candidate;
}

export function buildPendingStatus(typing, activity, pendingState) {
  const toolCount = Array.isArray(activity?.toolRuns) ? activity.toolRuns.length : 0;
  const assistantMsg = newestAssistantSince(activity?.messages || [], activity?.since || pendingState?.startedAt || '');
  if (assistantMsg?.content) return 'Final response ready. Restoring answer...';
  if (!pendingState?.pending && toolCount > 0) return 'Finalizing response...';
  if (toolCount === 0) return 'Routing request...';
  if ((typing?.pollCount || 0) <= 1) return `Executing tools... (${toolCount})`;
  if ((typing?.lastToolCount || 0) === toolCount) return 'Waiting for provider response...';
  return `Processing tool results... (${toolCount})`;
}

export function isStatusCheckMessage(message) {
  const t = String(message || '').toLowerCase().trim();
  return /^(are you done\??|done\??|status\??|progress\??|did you finish\??|finished\??|so you done\??)$/.test(t);
}

export function isPlanningReply(out) {
  const iters = Array.isArray(out?.trace?.iterations) ? out.trace.iterations : [];
  const last = iters.length > 0 ? iters[iters.length - 1] : null;
  const txt = String(last?.assistantText || out?.reply || '').toLowerCase();
  return /\b(plan|step\s*\d|next|let me|i will|going to|continue|create)\b/.test(txt);
}

export function shouldEscalateToAuto(message, out, autoEscalateEnabled = true) {
  if (!autoEscalateEnabled) return false;
  if (/^\/\w+/.test(String(message || '').trim())) return false;
  if (!out || out.pending) return false;
  if (isStatusCheckMessage(message)) return false;
  const reply = String(out.reply || '').toLowerCase();
  const completeSignals = ['mission_status: done', 'task completed', 'completed successfully', 'done'];
  if (completeSignals.some((s) => reply.includes(s))) return false;

  const iters = Array.isArray(out?.trace?.iterations) ? out.trace.iterations : [];
  const hadTools = iters.some((it) => Array.isArray(it.toolCalls) && it.toolCalls.length > 0);
  const last = iters.length > 0 ? iters[iters.length - 1] : null;
  const lastHasNoTools = !last || !Array.isArray(last.toolCalls) || last.toolCalls.length === 0;
  const planningText = String(last?.assistantText || out.reply || '').toLowerCase();
  const planningSignal = /\b(plan|step\s*\d|next|let me|i will|going to|continue|create)\b/.test(planningText);

  return lastHasNoTools && planningSignal && (hadTools || planningText.length > 80);
}

export function formatProviderModel(provider, model) {
  const p = String(provider || '').trim().replace(/^generic$/, 'openai').replace(/^ollama$/, 'ollama-cloud');
  const m = String(model || '').trim();
  if (!p) return m;
  if (!m) return p;
  if (m.startsWith(`${p}/`)) return m;
  if (/^(ollama-local|ollama-cloud|ollama|openrouter|nvidia|xiaomimimo|generic|openai)\//.test(m)) {
    return m.replace(/^generic\//, 'openai/').replace(/^ollama\//, `${p}/`);
  }
  return `${p}/${m}`;
}

export function stripProviderPrefix(modelRef, providerIds = []) {
  const value = String(modelRef || '').trim();
  if (!value) return '';
  const candidates = ['generic', 'ollama', ...providerIds, ...PROVIDER_PREFIXES];
  for (const provider of new Set(candidates)) {
    const prefix = `${provider}/`;
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return value;
}
