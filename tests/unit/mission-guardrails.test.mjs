import { describe, expect, it } from 'vitest';
import {
  getMissionEffectiveStepLimit,
  getMissionLimitSource,
  getMissionOperatorState
} from '../../src/core/missions.mjs';

describe('mission guardrails', () => {
  it('uses hardStepCap as effective limit when continueUntilDone is enabled', () => {
    const mission = { maxSteps: 6, hardStepCap: 120, continueUntilDone: true };
    expect(getMissionEffectiveStepLimit(mission)).toBe(120);
    expect(getMissionLimitSource(mission)).toBe('hardStepCap');
  });

  it('uses maxSteps as effective limit when continueUntilDone is disabled', () => {
    const mission = { maxSteps: 6, hardStepCap: 120, continueUntilDone: false };
    expect(getMissionEffectiveStepLimit(mission)).toBe(6);
    expect(getMissionLimitSource(mission)).toBe('maxSteps');
  });

  it('builds bounded operator stall thresholds from mission limits', () => {
    const state = getMissionOperatorState({ maxSteps: 6, hardStepCap: 120, continueUntilDone: true });
    expect(state.effectiveStepLimit).toBe(120);
    expect(state.noProgressAbortThreshold).toBeGreaterThanOrEqual(3);
    expect(state.repeatedReplyAbortThreshold).toBeGreaterThanOrEqual(2);
  });
});
