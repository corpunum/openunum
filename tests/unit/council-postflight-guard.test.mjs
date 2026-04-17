import { describe, expect, it } from 'vitest';
import { shouldSkipCouncilRevisionForMildProofDeficit } from '../../src/core/agent.mjs';

describe('council postflight mild-deficit guard', () => {
  it('skips revision for mild proof deficit when tool evidence exists', () => {
    const decision = shouldSkipCouncilRevisionForMildProofDeficit({
      proofResult: {
        reason: 'proof_quality_insufficient: score 0.66 < threshold 0.7',
        proofScore: { score: 0.66 }
      },
      minProofScore: 0.7,
      executedTools: [{ toolName: 'file_write' }],
      independentVerification: { verified: true }
    });
    expect(decision).toBe(true);
  });

  it('does not skip revision when deficit is large', () => {
    const decision = shouldSkipCouncilRevisionForMildProofDeficit({
      proofResult: {
        reason: 'proof_quality_insufficient: score 0.45 < threshold 0.7',
        proofScore: { score: 0.45 }
      },
      minProofScore: 0.7,
      executedTools: [{ toolName: 'file_write' }]
    });
    expect(decision).toBe(false);
  });

  it('does not skip revision without evidence', () => {
    const decision = shouldSkipCouncilRevisionForMildProofDeficit({
      proofResult: {
        reason: 'proof_quality_insufficient: score 0.67 < threshold 0.7',
        proofScore: { score: 0.67 }
      },
      minProofScore: 0.7,
      executedTools: [],
      independentVerification: { verified: false }
    });
    expect(decision).toBe(false);
  });
});
