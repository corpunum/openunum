function cleanProfile(profile = {}) {
  return {
    id: String(profile.id || '').trim(),
    type: String(profile.type || 'model').trim(),
    provider: String(profile.provider || '').trim(),
    model: String(profile.model || '').trim(),
    timeoutMs: Number.isFinite(profile.timeoutMs) ? Number(profile.timeoutMs) : 20000
  };
}

function fallbackModelForProvider(config = {}, provider) {
  const p = String(provider || '').trim();
  const providerModels = config?.model?.providerModels || {};
  return String(providerModels[p] || config?.model?.model || '').trim();
}

function defaultToolProfiles(config = {}, toolName) {
  const localModel = fallbackModelForProvider(config, 'ollama-local');
  const cloudModel = fallbackModelForProvider(config, 'ollama-cloud');
  const local = cleanProfile({
    id: `${toolName}.local`,
    type: 'model',
    provider: 'ollama-local',
    model: localModel,
    timeoutMs: 18000
  });
  const cloud = cleanProfile({
    id: `${toolName}.cloud`,
    type: 'model',
    provider: 'ollama-cloud',
    model: cloudModel,
    timeoutMs: 25000
  });
  return [local, cloud].filter((item) => item.provider && item.model);
}

export function resolveBackendProfiles(config = {}, toolName) {
  const settings = config?.runtime?.modelBackedTools?.tools?.[toolName] || {};
  const configured = Array.isArray(settings.backendProfiles)
    ? settings.backendProfiles.map(cleanProfile).filter((p) => p.id && p.provider && p.model)
    : [];
  return configured.length > 0 ? configured : defaultToolProfiles(config, toolName);
}

