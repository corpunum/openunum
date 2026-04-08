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
  if (provider === 'xiaomimimo') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.xiaomimimoBaseUrl,
      apiKey: config.model.xiaomimimoApiKey,
      model: normalizeProviderModelId('xiaomimimo', model),
      timeoutMs
    });
  }
  return stripped;
}

export function buildProvider(config) {
  const model = config.model.model;
  const provider = normalizeProviderId(config.model.provider);
  const timeoutMs = config.runtime?.providerRequestTimeoutMs ?? 120000;

  if (provider === 'ollama-cloud' || provider === 'ollama-local') {
    return new OllamaProvider({ baseUrl: config.model.ollamaBaseUrl, model, timeoutMs });
  }
  if (provider === 'openrouter') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.openrouterBaseUrl,
      apiKey: config.model.openrouterApiKey,
      model: normalizeProviderModelId('openrouter', model),
      timeoutMs
    });
  }
  if (provider === 'nvidia') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.nvidiaBaseUrl,
      apiKey: config.model.nvidiaApiKey,
      model: normalizeProviderModelId('nvidia', model),
      timeoutMs
    });
  }
  if (provider === 'openai') {
    const oauth = getStoredOpenAICodexOAuth() || getEffectiveOpenAICodexOAuthStatus().active;
    const apiKey = config.model.openaiApiKey || config.model.genericApiKey;
    if (oauth && (!apiKey || prefersOpenAICodexTransport(model))) {
      return new OpenAICodexOAuthProvider({
        model: model.replace(/^(generic|openai)\//, ''),
        timeoutMs
      });
    }
    return new OpenAICompatibleProvider({
      baseUrl: config.model.openaiBaseUrl || config.model.genericBaseUrl,
      apiKey: config.model.openaiApiKey || config.model.genericApiKey,
      model: model.replace(/^(generic|openai)\//, ''),
      timeoutMs
    });
  }
  throw new Error(`Unsupported provider: ${provider}`);
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
