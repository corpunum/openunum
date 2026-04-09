import { describe, expect, it } from 'vitest';
import { buildModelBackedToolSchemas, normalizeModelBackedOutput } from '../../src/tools/backends/contracts.mjs';

describe('model-backed contracts', () => {
  it('exposes phase-1 model-backed schemas', () => {
    const schemas = buildModelBackedToolSchemas({ exposeToController: true });
    const names = schemas.map((s) => s.function.name);
    expect(names).toContain('summarize');
    expect(names).toContain('classify');
    expect(names).toContain('extract');
    expect(names).toContain('parse_function_args');
    expect(names).toContain('embed_text');
    expect(names).not.toContain('suggest_code_patch');
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

  it('normalizes parse_function_args arguments object', () => {
    const out = normalizeModelBackedOutput('parse_function_args', {
      ok: true,
      data: { arguments: { name: 'alpha', priority: 'high' } },
      confidence: 0.7
    }, {
      id: 'parse.local',
      provider: 'ollama-local',
      model: 'ollama-local/functiongemma:270m'
    });
    expect(out.ok).toBe(true);
    expect(out.data.arguments.name).toBe('alpha');
  });

  it('normalizes embed_text numeric vectors and rejects invalid payloads', () => {
    const ok = normalizeModelBackedOutput('embed_text', {
      ok: true,
      data: { embedding: ['1.5', 2, 3.25] },
      confidence: 0.9
    }, {
      id: 'embed.local',
      provider: 'ollama-local',
      model: 'ollama-local/nomic-embed-text:v1.5'
    });
    expect(ok.ok).toBe(true);
    expect(ok.data.embedding).toEqual([1.5, 2, 3.25]);

    const bad = normalizeModelBackedOutput('embed_text', {
      ok: true,
      data: { embedding: [] },
      confidence: 0.9
    }, {
      id: 'embed.local',
      provider: 'ollama-local',
      model: 'ollama-local/nomic-embed-text:v1.5'
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('validation_failed');
  });
});
