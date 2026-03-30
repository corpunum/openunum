import { OpenAICompatibleProvider } from './openai-compatible.mjs';
import { OllamaProvider } from './ollama.mjs';

export function buildProvider(config) {
  const model = config.model.model;
  const provider = config.model.provider;
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
  if (provider === 'generic') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.genericBaseUrl,
      apiKey: config.model.genericApiKey,
      model: model.replace(/^generic\//, ''),
      timeoutMs
    });
  }
  throw new Error(`Unsupported provider: ${provider}`);
}
