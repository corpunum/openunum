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

  it('deduplicates repeated step suggestions for identical successful tools', () => {
    const out = synthesizeToolOnlyAnswer({
      userMessage: 'read your own code and tell me what will not work for you and how probably we can fix it',
      toolRuns: 3,
      executedTools: [
        { name: 'file_read', result: { ok: true, path: '/home/corp-unum/openunum/src/core/agent.mjs' } },
        { name: 'file_read', result: { ok: true, path: '/home/corp-unum/openunum/src/core/agent.mjs' } },
        { name: 'file_read', result: { ok: true, path: '/home/corp-unum/openunum/src/core/agent.mjs' } }
      ]
    });
    const repeatedLine = 'Use the verified result from `file_read` at `/home/corp-unum/openunum/src/core/agent.mjs` as the next execution anchor.';
    const count = out.split(repeatedLine).length - 1;
    expect(count).toBe(1);
  });

  it('deduplicates repeated status findings for identical tool outputs', () => {
    const out = synthesizeToolOnlyAnswer({
      userMessage: 'status update please',
      toolRuns: 3,
      executedTools: [
        { name: 'shell_run', result: { ok: true, code: 0, stdout: 'ok' } },
        { name: 'shell_run', result: { ok: true, code: 0, stdout: 'ok' } },
        { name: 'shell_run', result: { ok: true, code: 0, stdout: 'ok' } }
      ]
    });
    const line = 'shell_run: ✅ exit 0 — ok';
    const count = out.split(line).length - 1;
    expect(count).toBe(1);
  });
});
