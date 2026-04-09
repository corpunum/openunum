import {
  knownProviderRowIds as knownProviderRowIdsForVisibility,
  knownServiceRowIds as knownServiceRowIdsForVisibility,
  normalizeHiddenRows as normalizeHiddenRowsForVisibility,
  buildAddRowSelectMarkup
} from './visibility.js';
import {
  normalizeFallbackSequence,
  buildFallbackModelOptions as buildFallbackModelOptionsFromCatalog
} from './model-routing.js';

export function createProviderVaultHelpers({
  q,
  localStorage,
  escapeHtml,
  getModelProviderIds,
  getServiceProviderIds,
  getAuthCatalog,
  getModelCatalog,
  getRuntimeOverview,
  getHiddenProviderRows,
  setHiddenProviderRows,
  getHiddenServiceRows,
  setHiddenServiceRows,
  getFallbackSequence,
  setFallbackSequence
}) {
  function formatPct(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '-';
    return `${(num * 100).toFixed(1)}%`;
  }

  function knownProviderRowIds() {
    return knownProviderRowIdsForVisibility(getModelProviderIds(), getAuthCatalog()?.providers || []);
  }

  function knownServiceRowIds() {
    return knownServiceRowIdsForVisibility(getServiceProviderIds(), getAuthCatalog()?.auth_methods || []);
  }

  function normalizeHiddenRows() {
    const out = normalizeHiddenRowsForVisibility({
      hiddenProviderRows: getHiddenProviderRows(),
      hiddenServiceRows: getHiddenServiceRows(),
      knownProviders: knownProviderRowIds(),
      knownServices: knownServiceRowIds()
    });
    setHiddenProviderRows(out.hiddenProviderRows);
    setHiddenServiceRows(out.hiddenServiceRows);
    localStorage.setItem('openunum_hidden_provider_rows', JSON.stringify(out.hiddenProviderRows));
    localStorage.setItem('openunum_hidden_service_rows', JSON.stringify(out.hiddenServiceRows));
  }

  function providerCatalogRow(provider) {
    return (getAuthCatalog()?.providers || []).find((row) => row.provider === provider) || null;
  }

  function catalogModelsForProvider(provider) {
    return getModelCatalog()?.providers?.find((row) => row.provider === provider)?.models || [];
  }

  function preferredModelForProvider(provider) {
    const runtimeOverview = getRuntimeOverview();
    const fromConfig = runtimeOverview?.selectedModel?.provider === provider
      ? runtimeOverview.selectedModel.model_id
      : null;
    if (fromConfig) return fromConfig;
    const row = providerCatalogRow(provider);
    if (row?.top_model) return row.top_model;
    return catalogModelsForProvider(provider)?.[0]?.model_id || '';
  }

  function ensureFallbackSequence(primaryProvider) {
    const normalizedPrimary = String(primaryProvider || q('provider')?.value || 'ollama-cloud');
    const next = normalizeFallbackSequence(getFallbackSequence(), normalizedPrimary, preferredModelForProvider);
    setFallbackSequence(next);
  }

  function buildFallbackModelOptions(provider, selectedModel = '') {
    return buildFallbackModelOptionsFromCatalog(catalogModelsForProvider(provider), selectedModel, escapeHtml);
  }

  function refreshAddRowSelectors() {
    const providerSelect = q('providerAddSelect');
    const serviceSelect = q('serviceAddSelect');
    const markup = buildAddRowSelectMarkup({
      knownProviders: knownProviderRowIds(),
      knownServices: knownServiceRowIds(),
      hiddenProviderRows: getHiddenProviderRows(),
      hiddenServiceRows: getHiddenServiceRows()
    });
    if (providerSelect) {
      providerSelect.innerHTML = markup.providerOptions;
    }
    if (serviceSelect) {
      serviceSelect.innerHTML = markup.serviceOptions;
    }
  }

  function authMethodById(id) {
    return (getAuthCatalog()?.auth_methods || []).find((row) => row.id === id) || null;
  }

  return {
    formatPct,
    knownProviderRowIds,
    knownServiceRowIds,
    normalizeHiddenRows,
    providerCatalogRow,
    catalogModelsForProvider,
    preferredModelForProvider,
    ensureFallbackSequence,
    buildFallbackModelOptions,
    refreshAddRowSelectors,
    authMethodById
  };
}
