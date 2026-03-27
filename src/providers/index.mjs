import { OpenAICompatibleProvider } from './openai-compatible.mjs';
import { OllamaProvider } from './ollama.mjs';

export function buildProvider(config) {
  const model = config.model.model;
  const provider = config.model.provider;

  if (provider === 'ollama') {
    return new OllamaProvider({ baseUrl: config.model.ollamaBaseUrl, model });
  }
  if (provider === 'openrouter') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.openrouterBaseUrl,
      apiKey: config.model.openrouterApiKey,
      model: model.replace(/^openrouter\//, '')
    });
  }
  if (provider === 'nvidia') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.nvidiaBaseUrl,
      apiKey: config.model.nvidiaApiKey,
      model: model.replace(/^nvidia\//, '')
    });
  }
  if (provider === 'generic') {
    return new OpenAICompatibleProvider({
      baseUrl: config.model.genericBaseUrl,
      apiKey: config.model.genericApiKey,
      model: model.replace(/^generic\//, '')
    });
  }
  throw new Error(`Unsupported provider: ${provider}`);
}
