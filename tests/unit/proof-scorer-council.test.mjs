import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProofScorerCouncil } from '../../src/core/council/proof-scorer.mjs';

describe('ProofScorerCouncil', () => {
  const originalHome = process.env.OPENUNUM_HOME;
  let tempHome;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-proof-council-'));
    process.env.OPENUNUM_HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OPENUNUM_HOME;
    else process.env.OPENUNUM_HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('requires revision when the computed proof score is below the threshold', async () => {
    const council = new ProofScorerCouncil({
      config: {
        runtime: {
          minProofScore: 0.7
        }
      }
    });

    const out = await council.postFlight({
      response: 'Done.',
      toolRuns: [],
      message: 'Fix the runtime and verify the result',
      sessionId: 'proof-council-test'
    });

    expect(out.passed).toBe(false);
    expect(out.requiresRevision).toBe(true);
    expect(Number(out.proofScore.score)).toBeLessThan(0.7);
  });
});
