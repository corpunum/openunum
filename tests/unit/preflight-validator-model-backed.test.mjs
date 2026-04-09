import { describe, expect, it } from 'vitest';
import { validateToolCall } from '../../src/core/preflight-validator.mjs';

describe('preflight-validator model-backed', () => {
  it('accepts summarize with required text arg', () => {
    const out = validateToolCall('summarize', { text: 'abc' });
    expect(out.valid).toBe(true);
  });

  it('rejects classify with one label', () => {
    const out = validateToolCall('classify', { text: 'hello', labels: ['greeting'] });
    expect(out.valid).toBe(false);
  });

  it('uses cmd for shell_run contract', () => {
    const out = validateToolCall('shell_run', { cmd: 'echo ok' });
    expect(out.valid).toBe(true);
  });

  it('accepts extract with text and fields', () => {
    const out = validateToolCall('extract', { text: 'a:b', fields: ['a'] });
    expect(out.valid).toBe(true);
  });

  it('accepts parse_function_args with text payload', () => {
    const out = validateToolCall('parse_function_args', { text: 'Create mission alpha with owner ops' });
    expect(out.valid).toBe(true);
  });

  it('accepts embed_text with text payload', () => {
    const out = validateToolCall('embed_text', { text: 'OpenUnum retrieval test', dimensions: 32 });
    expect(out.valid).toBe(true);
  });
});
