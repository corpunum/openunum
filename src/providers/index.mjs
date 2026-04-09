import { OpenAICompatibleProvider } from './openai-compatible.mjs';
import { OpenAICodexOAuthProvider } from './openai-codex-oauth.mjs';
import { OllamaProvider } from './ollama.mjs';
import { getEffectiveOpenAICodexOAuthStatus, getStoredOpenAICodexOAuth } from '../secrets/store.mjs';
import { RetryPolicy, ProviderHealthTracker, defaultRetryPolicy, healthTracker } from './retry-policy.mjs';

function normalizeProviderId(provider) {
  const normalized = String(provider || 'ollama-cloud').trim().toLowerCase();
  if (normalized === 'generic') return 'openai';
  if (normalized === 'ollama') return 'ollama-cloud';
  return normalized;
}

function prefersOpenAICodexTransport(model) {
  const id = String(model || '').replace(/^(generic|openai)\//, '').trim().toLowerCase();
  return /^gpt-5/.test(id) || id.includes('codex');
}

function normalizeProviderModelId(provider, model) {
  const raw = String(model || '').trim();
  if (!raw) return raw;
  const prefix = `${provider}/`;
  if (!raw.startsWith(prefix)) return raw;
  const stripped = raw.slice(prefix.length);
  if (provider === 'nvidia') {
    return stripped.includes('/') ? stripped : raw;
  }
  return stripped;
}

export function buildProvider(config) {
  return buildProviderForModel(config, {
    provider: config?.model?.provider,
    model: config?.model?.model,
    timeoutMs: config?.runtime?.providerRequestTimeoutMs ?? 120000
  });
}

export function buildProviderForModel(config, { provider, model, timeoutMs } = {}) {
  const selectedProvider = normalizeProviderId(provider || config?.model?.provider);
  const selectedModel = String(model || config?.model?.model || '').trim();
  const effectiveTimeout = Number.isFinite(timeoutMs)
    ? Number(timeoutMs)
    : (config?.runtime?.providerRequestTimeoutMs ?? 120000);

  if (selectedProvider === 'ollama-cloud' || selectedProvider === 'ollama-local') {
    return new OllamaProvider({ baseUrl: config.model.ollamaBaseUrl, model: selectedModel, timeoutMs: effectiveTimeout });
  }
  if (selectedProvider === 'openrouter') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.openrouterBaseUrl,
      apiKey: config.model.openrouterApiKey,
      model: normalizeProviderModelId('openrouter', selectedModel),
      timeoutMs: effectiveTimeout
    });
  }
  if (selectedProvider === 'nvidia') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.nvidiaBaseUrl,
      apiKey: config.model.nvidiaApiKey,
      model: normalizeProviderModelId('nvidia', selectedModel),
      timeoutMs: effectiveTimeout
    });
  }
  if (selectedProvider === 'xiaomimimo') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.xiaomimimoBaseUrl,
      apiKey: config.model.xiaomimimoApiKey,
      model: normalizeProviderModelId('xiaomimimo', selectedModel),
      timeoutMs: effectiveTimeout
    });
  }
  if (selectedProvider === 'openai') {
    const oauth = getStoredOpenAICodexOAuth() || getEffectiveOpenAICodexOAuthStatus().active;
    const apiKey = config.model.openaiApiKey || config.model.genericApiKey;
    if (oauth && (!apiKey || prefersOpenAICodexTransport(selectedModel))) {
      return new OpenAICodexOAuthProvider({
        model: selectedModel.replace(/^(generic|openai)\//, ''),
        timeoutMs: effectiveTimeout
      });
    }
    return new OpenAICompatibleProvider({
      baseUrl: config.model.openaiBaseUrl || config.model.genericBaseUrl,
      apiKey: config.model.openaiApiKey || config.model.genericApiKey,
      model: selectedModel.replace(/^(generic|openai)\//, ''),
      timeoutMs: effectiveTimeout
    });
  }
  throw new Error(`Unsupported provider: ${selectedProvider}`);
}

/**
 * Invoke a provider with retry logic and health tracking.
 * @param {Object} config - Provider config
 * @param {Object} options
 * @param {string} options.providerName - Provider name for health tracking
 * @param {RetryPolicy} options.retryPolicy - Retry policy to use
 * @returns {Promise<*>} Provider response
 */
export async function invoke(config, { providerName, retryPolicy } = {}) {
  const policy = retryPolicy || defaultRetryPolicy;
  const name = providerName || normalizeProviderId(config?.model?.provider);

  // Check health before attempting
  if (!healthTracker.isHealthy(name)) {
    throw new Error(`Provider '${name}' is in backoff (too many consecutive failures)`);
  }

  try {
    const result = await policy.execute(
      () => {
        const provider = buildProvider(config);
        return provider.generate(config.messages || [], config.model || {});
      },
      { provider: name, operation: 'generate' }
    );

    healthTracker.recordSuccess(name);
    return result;
  } catch (error) {
    healthTracker.recordFailure(name);
    throw error;
  }
}

export { RetryPolicy, ProviderHealthTracker, defaultRetryPolicy, healthTracker };
