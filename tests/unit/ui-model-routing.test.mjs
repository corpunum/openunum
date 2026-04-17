import { describe, it, expect } from 'vitest';
import {
  normalizeFallbackSequence,
  buildFallbackModelOptions,
  providerChoicesForFallbackRow,
  canAddFallbackProvider,
  autoFillFallbackSequence,
  computeOnlineFallbackSequence,
  buildProviderModelsPatch
} from '../../src/ui/modules/model-routing.js';

const escapeHtml = (s) => String(s || '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

describe('ui model routing helpers', () => {
  it('normalizes and deduplicates fallback sequence', () => {
    const out = normalizeFallbackSequence(
      [{ provider: 'openrouter', model: '' }, { provider: 'openrouter', model: 'm2' }, { provider: 'ollama-cloud', model: 'x' }],
      'ollama-cloud',
      () => 'm1'
    );
    expect(out).toEqual([{ provider: 'openrouter', model: 'm1' }]);
  });

  it('builds model options and provider choices', () => {
    const html = buildFallbackModelOptions([{ model_id: 'm1', rank: 1 }], 'm1', escapeHtml);
    expect(html.includes('selected')).toBe(true);
    const choices = providerChoicesForFallbackRow(
      ['ollama-cloud', 'openrouter', 'nvidia'],
      [{ provider: 'openrouter', model: 'm1' }],
      'ollama-cloud',
      0
    );
    expect(choices).toContain('openrouter');
    expect(choices).not.toContain('ollama-cloud');
  });

  it('builds add/auto-fill and online model filtering', () => {
    expect(canAddFallbackProvider('openrouter', 'ollama-cloud', [])).toBe(true);
    expect(canAddFallbackProvider('ollama-cloud', 'ollama-cloud', [])).toBe(false);
    const filled = autoFillFallbackSequence(['ollama-cloud', 'openrouter'], 'ollama-cloud', () => 'm1');
    expect(filled).toEqual([{ provider: 'openrouter', model: 'm1' }]);
    const online = computeOnlineFallbackSequence(
      [{ provider: 'openrouter', model: 'm1' }, { provider: 'nvidia', model: 'm2' }],
      {
        providers: [
          { provider: 'openrouter', models: [{ model_id: 'm1', status: 'healthy' }] },
          { provider: 'nvidia', models: [{ model_id: 'm2', status: 'offline' }] }
        ]
      }
    );
    expect(online).toEqual([{ provider: 'openrouter', model: 'm1' }]);
  });

  it('builds provider model patch map', () => {
    const out = buildProviderModelsPatch('ollama-cloud', 'qwen3.5:397b-cloud', [{ provider: 'openrouter', model: 'auto' }]);
    expect(out['ollama-cloud']).toBe('ollama-cloud/qwen3.5:397b-cloud');
    expect(out.openrouter).toBe('openrouter/auto');
  });
});
