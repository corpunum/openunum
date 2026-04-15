import { describe, expect, it } from 'vitest';
import { execute } from '../../src/skills/unum-council/index.mjs';

describe('unum council fallback', () => {
  it('fills the council from fallback candidates when earlier members fail', async () => {
    const attempts = [];
    const result = await execute(
      {
        request: 'Review the system and propose two actions.',
        count: 2
      },
      {
        discoverCandidates: async () => [
          { provider: 'ollama-cloud', model_id: 'primary-a', display_name: 'Primary A', capability_score: 100, source: 'test' },
          { provider: 'nvidia', model_id: 'primary-b', display_name: 'Primary B', capability_score: 99, source: 'test' },
          { provider: 'ollama-cloud', model_id: 'fallback-c', display_name: 'Fallback C', capability_score: 98, source: 'test' }
        ],
        queryMember: async (_config, member) => {
          attempts.push(member.modelRef);
          if (attempts.length === 1) {
            throw new Error('provider_timeout');
          }
          return {
            ok: true,
            member: member.modelRef,
            summary: `summary from ${member.modelRef}`,
            claims: ['Use provider fallback.'],
            actions: ['Keep retry pool wider than target council size.'],
            risks: ['Provider timeouts can starve the council.'],
            confidence: 0.8
          };
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(result.council).toHaveLength(2);
    expect(result.memberResponses.some((item) => item.ok === false)).toBe(true);
    expect(result.attemptedMembers.length).toBeGreaterThan(2);
    expect(result.final.approvedActions[0]).toContain('retry pool');
  });
});
