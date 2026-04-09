import { describe, expect, it } from 'vitest';
import { buildModelBackedToolSchemas, normalizeModelBackedOutput } from '../../src/tools/backends/contracts.mjs';

describe('model-backed contracts', () => {
  it('exposes summarize and classify schemas', () => {
    const schemas = buildModelBackedToolSchemas({ exposeToController: true });
    const names = schemas.map((s) => s.function.name);
    expect(names).toContain('summarize');
    expect(names).toContain('classify');
    expect(names).toContain('extract');
  });

  it('normalizes valid summarize output', () => {
    const out = normalizeModelBackedOutput('summarize', {
      ok: true,
      data: { summary: 'hello' },
      confidence: 0.6
    }, {
      id: 'sum.local',
      provider: 'ollama-local',
      model: 'ollama-local/gemma4:cpu'
    });
    expect(out.ok).toBe(true);
    expect(out.data.summary).toBe('hello');
    expect(out.validation.contractOk).toBe(true);
  });

  it('rejects missing required output data fields', () => {
    const out = normalizeModelBackedOutput('classify', {
      ok: true,
      data: { label: 'x' },
      confidence: 0.8
    }, {
      id: 'cls.local',
      provider: 'ollama-local',
      model: 'ollama-local/gemma4:cpu'
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('validation_failed');
  });
});
