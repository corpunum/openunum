import { describe, expect, it } from 'vitest';
import { FastAwarenessRouter } from '../../src/core/fast-awareness-router.mjs';

describe('fast awareness routing regression', () => {
  it('does not classify the spot-the-difference build prompt as continuation', () => {
    const router = new FastAwarenessRouter({ enabled: true });
    const result = router.classify(
      'can you for example write an html page with a simple game like showing two almost identical pictures for to spot the 3 differences? after i click on them and find them i can proceed to the next stage a different stack of picture with more differences harder to find etc. lets do one set for now. can you build that ?'
    );

    expect(result.category).not.toBe('continuation');
    expect(result.category).not.toBe('external');
    expect(result.strategy).not.toBe('hot-only');
    expect(result.strategy).not.toBe('full-search');
  });
});
