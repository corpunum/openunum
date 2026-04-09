import { describe, it, expect } from 'vitest';
import { synthesizeToolOnlyAnswer } from '../../src/core/turn-recovery-summary.mjs';

describe('turn recovery search constraints', () => {
  it('fails closed when strict repo/date constraints are not evidenced', () => {
    const out = synthesizeToolOnlyAnswer({
      userMessage: 'search best github open source project march and april 2026 new entries only and return table no links',
      toolRuns: 2,
      executedTools: [
        {
          name: 'web_search',
          result: {
            ok: true,
            results: [
              { title: 'Top OSS Projects 2026', url: 'https://example.com/list', snippet: 'curated list' }
            ]
          }
        }
      ]
    });
    expect(out.toLowerCase()).toContain('insufficient evidence');
    expect(out.toLowerCase()).toContain('constraint check failed');
  });

  it('renders table when strict repo/date evidence exists', () => {
    const out = synthesizeToolOnlyAnswer({
      userMessage: 'search best github open source project march and april 2026 new entries only and return table no links',
      toolRuns: 2,
      executedTools: [
        {
          name: 'web_search',
          result: {
            ok: true,
            results: [
              {
                title: 'owner/repo',
                url: 'https://github.com/owner/repo',
                snippet: 'Updated in March 2026'
              }
            ]
          }
        }
      ]
    });
    expect(out).toContain('| Rank | Candidate | Notes |');
    expect(out).toContain('owner/repo');
  });
});

