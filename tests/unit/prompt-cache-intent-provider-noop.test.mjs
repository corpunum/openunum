import { describe, expect, it } from 'vitest';
import { OllamaProvider } from '../../src/providers/ollama.mjs';
import { OpenAICompatibleProvider } from '../../src/providers/openai-compatible.mjs';

describe('Prompt cache intent provider no-op', () => {
  it('OllamaProvider ignores cacheIntent metadata', () => {
    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'test-model' });
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' }
    ];

    const normalized = provider.constructor.normalizeMessages(messages);
    expect(normalized).toBeInstanceOf(Array);
    expect(normalized).toHaveLength(2);
    expect(normalized[0].role).toBe('system');
    expect(normalized[1].role).toBe('user');

    for (const msg of normalized) {
      expect(msg.cacheIntent).toBeUndefined();
      expect(msg.cache_key).toBeUndefined();
      expect(msg.prompt_cache_key).toBeUndefined();
    }
  });

  it('OpenAICompatibleProvider does not leak cache fields into request body', () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'http://127.0.0.1:18084',
      model: 'test-model'
    });

    expect(provider).toBeTruthy();
    expect(provider.model).toBe('test-model');
    expect(provider.baseUrl).toBe('http://127.0.0.1:18084');
  });

  it('cacheIntent does not alter OllamaProvider message normalization', () => {
    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'test' });
    const messagesWithoutCache = [
      { role: 'user', content: 'Hello' }
    ];
    const messagesWithCache = [
      { role: 'user', content: 'Hello', cacheIntent: { enabled: true } }
    ];

    const normWithout = provider.constructor.normalizeMessages(messagesWithoutCache);
    const normWith = provider.constructor.normalizeMessages(messagesWithCache);

    expect(normWithout).toHaveLength(normWith.length);
    for (let i = 0; i < normWithout.length; i += 1) {
      expect(normWithout[i].role).toBe(normWith[i].role);
      expect(normWithout[i].content).toBe(normWith[i].content);
    }
  });
});