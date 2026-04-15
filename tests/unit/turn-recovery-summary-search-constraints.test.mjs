import { describe, it, expect } from 'vitest';
import {
  getTurnRecoverySummaryMetrics,
  resetTurnRecoverySummaryMetrics,
  synthesizeToolOnlyAnswer
} from '../../src/core/turn-recovery-summary.mjs';

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

  it('uses web_fetch content fields as strict evidence, not only text aliases', () => {
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
                snippet: 'candidate repository'
              }
            ]
          }
        },
        {
          name: 'web_fetch',
          result: {
            ok: true,
            url: 'https://github.com/owner/repo',
            content: 'Repository created in March 2026 and updated in April 2026.'
          }
        }
      ]
    });
    expect(out).toContain('| Rank | Candidate | Notes |');
    expect(out).toContain('owner/repo');
  });

  it('deduplicates repeated step suggestions for identical successful tools', () => {
    resetTurnRecoverySummaryMetrics();
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
    const metrics = getTurnRecoverySummaryMetrics();
    expect(metrics.stepDedupeDrops).toBeGreaterThan(0);
  });

  it('deduplicates repeated status findings for identical tool outputs', () => {
    resetTurnRecoverySummaryMetrics();
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
    const metrics = getTurnRecoverySummaryMetrics();
    expect(metrics.statusDedupeDrops).toBeGreaterThan(0);
  });

  it('caps status findings and records cap drops for high-surface runs', () => {
    resetTurnRecoverySummaryMetrics();
    const executedTools = Array.from({ length: 10 }, (_, idx) => ({
      name: `tool_${idx + 1}`,
      result: { ok: true }
    }));
    const out = synthesizeToolOnlyAnswer({
      userMessage: 'status report',
      toolRuns: executedTools.length,
      executedTools
    });
    const findingsCount = out
      .split('\n')
      .filter((line) => /^tool_\d+:/.test(line.trim()))
      .length;
    expect(findingsCount).toBe(6);
  });

  it('suppresses circuit-open noise when successful evidence exists', () => {
    const out = synthesizeToolOnlyAnswer({
      userMessage: 'status update please',
      toolRuns: 3,
      executedTools: [
        { name: 'http_request', result: { ok: true, status: 200, url: 'https://arxiv.org/html/2603.28052v1' } },
        { name: 'web_fetch', result: { ok: false, error: 'tool_circuit_open' } }
      ]
    });
    expect(out).toContain('http_request: ✅ HTTP 200 arxiv.org');
    expect(out).not.toContain('tool_circuit_open');
  });

  it('treats legacy web_fetch payloads with content as successful evidence', () => {
    const out = synthesizeToolOnlyAnswer({
      userMessage: 'status update please',
      toolRuns: 3,
      executedTools: [
        { name: 'http_request', result: { ok: true, status: 200, url: 'https://arxiv.org/html/2603.28052v1' } },
        {
          name: 'web_fetch',
          result: {
            url: 'https://arxiv.org/html/2603.28052v1',
            title: 'Meta-Harness: End-to-End Optimization of Model Harnesses',
            content: 'Abstract The performance of large language model systems depends not only on model weights.'
          }
        }
      ]
    });
    expect(out).toContain('Status: ok');
    expect(out).toContain('web_fetch: ✅ fetched arxiv.org');
    expect(out).not.toContain('web_fetch: ❌');
  });

  it('builds a grounded document discussion for URL debate requests', () => {
    const out = synthesizeToolOnlyAnswer({
      userMessage: 'debate https://arxiv.org/html/2603.28052v1 and tell me what we should harvest for OpenUnum',
      toolRuns: 3,
      executedTools: [
        { name: 'http_request', result: { ok: true, status: 200, url: 'https://arxiv.org/html/2603.28052v1' } },
        {
          name: 'web_fetch',
          result: {
            url: 'https://arxiv.org/html/2603.28052v1',
            title: 'Meta-Harness: End-to-End Optimization of Model Harnesses',
            content: [
              'Abstract',
              'The performance of large language model systems depends not only on model weights, but also on their harness: the code that determines what information to store, retrieve, and present to the model.',
              'Meta-Harness uses an agentic proposer that accesses the source code, scores, and execution traces of all prior candidates through a filesystem.',
              'Practical Implementation Tips',
              'Log everything in a format that is easy to navigate.',
              'Make logs queryable through a small CLI.',
              'Lightweight validation before expensive benchmarks.',
              'Automate evaluation outside the proposer.'
            ].join('\n')
          }
        }
      ]
    });
    expect(out).toContain('Paper: Meta-Harness: End-to-End Optimization of Model Harnesses');
    expect(out).toContain('What to harvest:');
    expect(out).toContain('Bottom line:');
    expect(out).not.toContain('Status: ok');
  });

  it('prefers cleaner browser-extracted document evidence over raw fetched markup', () => {
    const out = synthesizeToolOnlyAnswer({
      userMessage: 'discuss https://arxiv.org/html/2603.28052v1 and what to harvest',
      toolRuns: 3,
      executedTools: [
        {
          name: 'web_fetch',
          result: {
            ok: true,
            url: 'https://arxiv.org/html/2603.28052v1',
            title: 'Meta-Harness: End-to-End Optimization of Model Harnesses',
            content: 'Report GitHub Issue <div>noisy markup</div> Abstract Meta-Harness raw html wrapper'
          }
        },
        {
          name: 'browser_extract',
          result: {
            ok: true,
            url: 'https://arxiv.org/html/2603.28052v1',
            text: [
              'Meta-Harness: End-to-End Optimization of Model Harnesses',
              'Abstract',
              'The performance of large language model systems depends not only on model weights, but also on their harness.'
            ].join('\n')
          }
        }
      ]
    });
    expect(out).toContain('Core claim: The performance of large language model systems depends not only on model weights');
    expect(out).not.toContain('Report GitHub Issue');
  });
});
