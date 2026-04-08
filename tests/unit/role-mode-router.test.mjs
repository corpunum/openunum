import { describe, it, expect } from 'vitest';
import { classifyRoleMode, modeDirective } from '../../src/core/role-mode-router.mjs';

describe('Role Mode Router', () => {
  it('classifies proof mode for validation prompts', () => {
    const out = classifyRoleMode({ message: 'verify with evidence and show test results' });
    expect(out.mode).toBe('proof');
  });

  it('classifies repair mode from failure context', () => {
    const out = classifyRoleMode({ message: 'continue', hasFailures: true });
    expect(out.mode).toBe('repair');
  });

  it('classifies retrieval mode from search prompts', () => {
    const out = classifyRoleMode({ message: 'search latest docs and news' });
    expect(out.mode).toBe('retrieval');
  });

  it('classifies intent mode for planning prompts', () => {
    const out = classifyRoleMode({ message: 'let us plan the strategy first' });
    expect(out.mode).toBe('intent');
  });

  it('returns directive string', () => {
    const line = modeDirective({ mode: 'execution' });
    expect(line).toContain('ROLE MODE: EXECUTION');
  });
});
