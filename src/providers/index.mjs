import { OpenAICompatibleProvider } from './openai-compatible.mjs';
import { OpenAICodexOAuthProvider } from './openai-codex-oauth.mjs';
import { OllamaProvider } from './ollama.mjs';
import { getEffectiveOpenAICodexOAuthStatus, getStoredOpenAICodexOAuth } from '../secrets/store.mjs';

function normalizeProviderId(provider) {
  return String(provider || 'ollama').trim().toLowerCase() === 'generic' ? 'openai' : String(provider || 'ollama').trim().toLowerCase();
}

function prefersOpenAICodexTransport(model) {
  const id = String(model || '').replace(/^(generic|openai)\//, '').trim().toLowerCase();
  return /^gpt-5/.test(id) || id.includes('codex');
}

export function buildProvider(config) {
  const model = config.model.model;
  const provider = normalizeProviderId(config.model.provider);
  const timeoutMs = config.runtime?.providerRequestTimeoutMs ?? 120000;

  if (provider === 'ollama') {
    return new OllamaProvider({ baseUrl: config.model.ollamaBaseUrl, model, timeoutMs });
  }
  if (provider === 'openrouter') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.openrouterBaseUrl,
      apiKey: config.model.openrouterApiKey,
      model: model.replace(/^openrouter\//, ''),
      timeoutMs
    });
  }
  if (provider === 'nvidia') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.nvidiaBaseUrl,
      apiKey: config.model.nvidiaApiKey,
      model: model.replace(/^nvidia\//, ''),
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
