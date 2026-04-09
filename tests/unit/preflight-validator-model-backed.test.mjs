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
});

