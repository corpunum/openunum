const SEARCH_CHALLENGE_PATTERNS = [
  'unfortunately, bots use',
  'select all squares containing',
  'verify you are human',
  'captcha',
  'challenge to confirm this search was made by a human'
];

function hasApiKey(name) {
  return Boolean(String(process.env[name] || '').trim());
}

export function buildSearchBackendChain({ requestedBackend = 'auto', browserAvailable = false } = {}) {
  const requested = String(requestedBackend || 'auto').toLowerCase();
  if (requested && requested !== 'auto') return [requested];

  const chain = [];
  chain.push('model-native');
  if (browserAvailable) chain.push('cdp');

  // Prefer managed API backends when credentials exist.
  if (hasApiKey('BRAVE_API_KEY')) chain.push('brave');
  if (hasApiKey('SERPAPI_KEY')) chain.push('serpapi');

  // Always keep no-key fallback.
  chain.push('duckduckgo');
  return [...new Set(chain)];
}

export function assessSearchEvidenceQuality(result = {}, { backend = '', query = '' } = {}) {
  const results = Array.isArray(result.results) ? result.results : [];
  const snippet = String(results[0]?.snippet || result?.text || '').toLowerCase();
  const title = String(results[0]?.title || '').toLowerCase();
  const url = String(results[0]?.url || '').toLowerCase();

  const challengeMatch = SEARCH_CHALLENGE_PATTERNS.find((p) => snippet.includes(p) || title.includes(p));
  if (challengeMatch) {
    return {
      ok: false,
      reason: 'challenge_page_detected',
      backend,
      signal: challengeMatch
    };
  }

  if (!results.length) {
    return {
      ok: false,
      reason: 'no_results',
      backend,
      signal: query ? `query=${query.slice(0, 80)}` : 'empty_result_set'
    };
  }

  const looksLikeOnlyEnginePage =
    backend === 'cdp' &&
    url.includes('duckduckgo.com/?q=') &&
    snippet.includes('duckduckgo') &&
    !snippet.includes('github.com/');

  if (looksLikeOnlyEnginePage) {
    return {
      ok: false,
      reason: 'low_signal_search_engine_page',
      backend,
      signal: 'cdp_returned_engine_ui_without_extractable_hits'
    };
  }

  return { ok: true, reason: 'evidence_ok', backend };
}
