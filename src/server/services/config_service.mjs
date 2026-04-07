import { normalizeProviderId } from '../../models/catalog.mjs';
import { applySecretsToConfig, loadSecretStore, mergeSecrets, saveSecretStore } from '../../secrets/store.mjs';

export function createConfigService({ config, PROVIDER_ORDER, reloadConfigSecrets }) {
  function normalizeModelSettings() {
    config.model.provider = normalizeProviderId(config.model.provider);
    config.model.providerModels = config.model.providerModels || {};
    if (config.model.providerModels.generic && !config.model.providerModels.openai) {
      config.model.providerModels.openai = String(config.model.providerModels.generic).replace(/^generic\//, 'openai/');
    }
    delete config.model.providerModels.generic;
    config.model.openaiBaseUrl = config.model.openaiBaseUrl || config.model.genericBaseUrl || 'https://api.openai.com/v1';
    config.model.openaiApiKey = config.model.openaiApiKey || config.model.genericApiKey || '';
    config.model.genericBaseUrl = config.model.openaiBaseUrl;
    config.model.genericApiKey = config.model.openaiApiKey;
    config.model.model = String(config.model.model || '').replace(/^generic\//, 'openai/');
    config.model.routing = config.model.routing || {};
    config.model.routing.fallbackProviders = (config.model.routing.fallbackProviders || PROVIDER_ORDER)
      .map((provider) => normalizeProviderId(provider))
      .filter((provider, index, arr) => provider && arr.indexOf(provider) === index);
    config.model.behaviorOverrides = config.model.behaviorOverrides || {};
  }

  function behaviorOverrideKey(provider, model) {
    const p = normalizeProviderId(provider || 'ollama');
    const m = String(model || '').trim().toLowerCase();
    return `${p}::${m}`;
  }

  function getProviderConfigPayload() {
    return {
      ollamaBaseUrl: config.model.ollamaBaseUrl,
      openrouterBaseUrl: config.model.openrouterBaseUrl,
      nvidiaBaseUrl: config.model.nvidiaBaseUrl,
      openaiBaseUrl: config.model.openaiBaseUrl || config.model.genericBaseUrl,
      genericBaseUrl: config.model.openaiBaseUrl || config.model.genericBaseUrl,
      hasOpenrouterApiKey: Boolean(config.model.openrouterApiKey),
      hasNvidiaApiKey: Boolean(config.model.nvidiaApiKey),
      hasOpenaiApiKey: Boolean(config.model.openaiApiKey || config.model.genericApiKey),
      hasGenericApiKey: Boolean(config.model.openaiApiKey || config.model.genericApiKey)
    };
  }

  function persistSecretUpdates(secretUpdates = {}, clear = []) {
    const currentStore = loadSecretStore();
    const nextStore = mergeSecrets(currentStore, secretUpdates, clear);
    saveSecretStore(nextStore);
    reloadConfigSecrets();
    return nextStore;
  }

  return {
    normalizeModelSettings,
    behaviorOverrideKey,
    getProviderConfigPayload,
    persistSecretUpdates
  };
}
