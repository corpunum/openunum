function lower(text) {
  return String(text || '').toLowerCase();
}

export function classifyProviderFailure(error) {
  const message = lower(error?.message || error || '');

  if (!message) return 'unknown';
  if (message.includes('timeout') || message.includes('timed out') || message.includes('provider_timeout')) return 'timeout';
  if (message.includes('unauthorized') || message.includes('invalid api key') || message.includes('authentication') || message.includes('forbidden') || /\b401\b|\b403\b/.test(message)) return 'auth';
  if (message.includes('not found') || /\b404\b/.test(message) || message.includes('model') && message.includes('missing')) return 'not_found';
  if (message.includes('quota') || message.includes('billing') || message.includes('insufficient credits') || /\b402\b/.test(message)) return 'quota';
  if (message.includes('rate limit') || /\b429\b/.test(message)) return 'rate_limited';
  if (message.includes('fetch failed') || message.includes('network') || message.includes('econn') || message.includes('enotfound') || message.includes('eai_again')) return 'network';
  return 'unknown';
}

export function resolveFallbackAction(kind, attemptNumber = 1) {
  const n = Number.isFinite(attemptNumber) ? Number(attemptNumber) : 1;
  switch (kind) {
    case 'timeout':
      return n === 1
        ? { action: 'retry_same_provider', cooldownMs: 0 }
        : { action: 'switch_provider', cooldownMs: 30000 };
    case 'network':
      return n === 1
        ? { action: 'retry_same_provider', cooldownMs: 0 }
        : { action: 'switch_provider', cooldownMs: 60000 };
    case 'rate_limited':
      return { action: 'switch_provider', cooldownMs: 120000 };
    case 'quota':
      return { action: 'switch_provider', cooldownMs: 10 * 60 * 1000 };
    case 'auth':
      return { action: 'switch_provider', cooldownMs: 60 * 60 * 1000 };
    case 'not_found':
      return { action: 'switch_provider', cooldownMs: 20 * 60 * 1000 };
    default:
      return n === 1
        ? { action: 'retry_same_provider', cooldownMs: 0 }
        : { action: 'switch_provider', cooldownMs: 45000 };
  }
}

export function shouldUseProvider(availabilityRow, nowMs = Date.now()) {
  if (!availabilityRow) return true;
  const until = Number(availabilityRow.blockedUntil || 0);
  return !until || nowMs >= until;
}
