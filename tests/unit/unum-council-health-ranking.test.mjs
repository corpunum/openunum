import { describe, expect, it } from 'vitest';
import { execute } from '../../src/skills/unum-council/index.mjs';

describe('unum council provider health ranking', () => {
  it('prefers healthier candidates inside the same provider preference tier', async () => {
    const out = await execute(
      {
        request: 'Assess current architecture quickly.',
        dryRun: true,
        count: 1
      },
      {
        discoverCandidates: async () => [
          {
            provider: 'ollama-cloud',
            model_id: 'top-capability-unhealthy',
            display_name: 'Unhealthy but large',
            capability_score: 999,
            providerStatus: 'unhealthy'
          },
          {
            provider: 'ollama-cloud',
            model_id: 'healthy-balanced',
            display_name: 'Healthy balanced',
            capability_score: 450,
            providerStatus: 'healthy'
          }
        ]
      }
    );

    expect(out.ok).toBe(true);
    expect(out.council[0]?.modelRef).toBe('ollama-cloud/healthy-balanced');
  });
});
