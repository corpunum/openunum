import { describe, expect, it } from 'vitest';
import { normalizeModelConfig } from '../../src/config.mjs';

describe('normalizeModelConfig', () => {
  it('removes the active provider from disabledProviders and clears fallbacks when disabled', () => {
    const out = normalizeModelConfig({
      provider: 'ollama-cloud',
      model: 'qwen3.5:397b-cloud',
      providerModels: {
        'ollama-cloud': 'ollama-cloud/qwen3.5:397b-cloud'
      },
      routing: {
        fallbackEnabled: false,
        fallbackProviders: ['openrouter', 'nvidia'],
        forcePrimaryProvider: true,
        disabledProviders: ['ollama-cloud', 'openrouter']
      }
    });

    expect(out.model).toBe('qwen3.5:397b-cloud');
    expect(out.routing.disabledProviders).toEqual(['openrouter']);
    expect(out.routing.fallbackProviders).toEqual([]);
    expect(out.routing.forcePrimaryProvider).toBe(true);
  });

  it('hydrates default fallback providers only when fallback routing is enabled', () => {
    const out = normalizeModelConfig({
      provider: 'ollama-local',
      model: 'ollama-local/gemma4:cpu',
      routing: {
        fallbackEnabled: true,
        fallbackProviders: []
      }
    });

    expect(out.routing.fallbackProviders.length).toBeGreaterThan(0);
    expect(out.routing.fallbackProviders).not.toContain('ollama-local');
  });
});
