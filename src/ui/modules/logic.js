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
