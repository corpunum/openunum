export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function scoreByOverlap(queryTokens, text) {
  const tokens = new Set(tokenize(text));
  if (!queryTokens.length || !tokens.size) return 0;
  let hits = 0;
  for (const t of queryTokens) if (tokens.has(t)) hits += 1;
  return hits / Math.sqrt(tokens.size);
}

export function summarizeSessionTitle(text) {
  const raw = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/[*_>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return 'New Chat';
  const words = raw.split(' ').filter(Boolean);
  const short = words.slice(0, 9).join(' ');
  return short.length > 72 ? `${short.slice(0, 69)}...` : short;
}

export function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text || 'null');
  } catch {
    return fallback;
  }
}
