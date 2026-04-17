import { describe, expect, it } from 'vitest';
import { decomposeTask } from '../../src/core/task-decomposer.mjs';

describe('TaskDecomposer regression', () => {
  it('creates task-specific decomposition for spot-the-difference game prompts', () => {
    const out = decomposeTask('write an html page game to spot the 3 differences and continue to next stage');
    expect(out.decomposed).toBe(true);
    expect(out.steps.length).toBeGreaterThanOrEqual(5);
    expect(out.steps.join(' ')).toMatch(/difference|click|progress/i);
  });

  it('returns mapped actionable fallback steps instead of generic execute verbs', () => {
    const out = decomposeTask('read config and update routing then verify');
    expect(out.decomposed).toBe(true);
    expect(out.steps.length).toBeGreaterThan(1);
    expect(out.steps.some((step) => step.includes('Execute:'))).toBe(false);
  });

  it('does not decompose broad verb lists with weak task signal', () => {
    const out = decomposeTask('read write create delete install configure test run check list find update modify deploy build verify');
    expect(out.decomposed).toBe(false);
    expect(out.steps).toEqual([]);
  });
});
