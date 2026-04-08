export function normalizeFallbackSequence(sequence = [], primaryProvider = '', preferredModelForProvider = () => '') {
  const primary = String(primaryProvider || '').trim();
  return (Array.isArray(sequence) ? sequence : [])
    .map((item) => ({
      provider: item.provider,
      model: item.model || preferredModelForProvider(item.provider)
    }))
    .filter((item, index, arr) => item.provider && item.provider !== primary && arr.findIndex((entry) => entry.provider === item.provider) === index);
}

export function buildFallbackModelOptions(models = [], selectedModel = '', escapeHtml) {
  return (Array.isArray(models) ? models : []).map((model) => {
    const modelId = model.model_id || model.id || '';
    return `<option value="${escapeHtml(modelId)}" ${modelId === selectedModel ? 'selected' : ''}>#${Number(model.rank || 0)} ${escapeHtml(modelId)}</option>`;
  }).join('');
}

export function providerChoicesForFallbackRow(modelProviderIds = [], sequence = [], primaryProvider = '', rowIndex = 0) {
  const providers = Array.isArray(modelProviderIds) ? modelProviderIds : [];
  const row = sequence[rowIndex] || {};
  return providers.filter((provider) =>
    provider === row.provider
    || (!sequence.some((item, itemIndex) => item.provider === provider && itemIndex !== rowIndex) && provider !== primaryProvider)
  );
}

export function canAddFallbackProvider(provider, primaryProvider, sequence = []) {
  const p = String(provider || '').trim();
  if (!p) return false;
  if (p === String(primaryProvider || '').trim()) return false;
  return !(Array.isArray(sequence) ? sequence : []).some((entry) => entry.provider === p);
}

export function autoFillFallbackSequence(modelProviderIds = [], primaryProvider = '', preferredModelForProvider = () => '') {
  return (Array.isArray(modelProviderIds) ? modelProviderIds : [])
    .filter((provider) => provider !== primaryProvider)
    .map((provider) => ({ provider, model: preferredModelForProvider(provider) }));
}

export function computeOnlineFallbackSequence(sequence = [], modelCatalog = { providers: [] }) {
  const providers = Array.isArray(modelCatalog?.providers) ? modelCatalog.providers : [];
  return (Array.isArray(sequence) ? sequence : []).filter((entry) => {
    const provider = providers.find((cp) => cp.provider === entry.provider);
    if (!provider) return true;
    const model = (provider.models || []).find((cm) => cm.model_id === entry.model);
    return Boolean(model && model.status !== 'offline' && model.status !== 'quarantined');
  });
}

export function buildProviderModelsPatch(primaryProvider, selectedModel, fallbackSequence = []) {
  const out = {
    [primaryProvider]: `${primaryProvider}/${selectedModel}`
  };
  for (const entry of (Array.isArray(fallbackSequence) ? fallbackSequence : [])) {
    if (entry.provider && entry.model) out[entry.provider] = `${entry.provider}/${entry.model}`;
  }
  return out;
}
