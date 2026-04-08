const SERVICE_FIELD_TO_ID = {
  githubtoken: 'github',
  copilotgithubtoken: 'github-copilot',
  huggingfaceapikey: 'huggingface',
  elevenlabsapikey: 'elevenlabs',
  telegrambottoken: 'telegram',
  openaioauthtoken: 'openai-oauth'
};

function normalizeToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeServiceCapabilityIds(services = [], fallbackIds = []) {
  const fallback = Array.isArray(fallbackIds) ? fallbackIds : [];
  const knownByToken = new Map(
    fallback.map((id) => [normalizeToken(id), id])
  );
  const out = [...fallback];
  const seen = new Set(out);

  for (const raw of (Array.isArray(services) ? services : [])) {
    const token = normalizeToken(raw);
    if (!token) continue;
    const mapped = SERVICE_FIELD_TO_ID[token] || knownByToken.get(token);
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }

  return out;
}
