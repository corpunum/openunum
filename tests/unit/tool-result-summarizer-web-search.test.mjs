import { describe, expect, it } from 'vitest';
import { summarizeToolResult } from '../../src/core/tool-result-summarizer.mjs';
import { synthesizeToolOnlyAnswer } from '../../src/core/turn-recovery-summary.mjs';

describe('tool-result-summarizer web_search', () => {
  it('preserves top structured results for web_search', () => {
    const longSnippet = 'x'.repeat(1200);
    const input = {
      ok: true,
      backend: 'duckduckgo',
      total: 10,
      results: [
        { title: 'Repo One', url: 'https://github.com/org/one', snippet: longSnippet },
        { title: 'Repo Two', url: 'https://github.com/org/two', snippet: longSnippet }
      ],
      searchAttempts: [{ backend: 'cdp', quality: { ok: false, reason: 'challenge_page_detected' } }],
      hookEvents: []
    };

    const out = summarizeToolResult('web_search', input, 200);
    expect(out.ok).toBe(true);
    expect(out.tool).toBe('web_search');
    expect(out._truncated).toBe(true);
    expect(Array.isArray(out.results)).toBe(true);
    expect(out.results[0].url).toBe('https://github.com/org/one');
    expect(Array.isArray(out.searchAttempts)).toBe(true);
  });

  it('preserves title and content shape for web_fetch', () => {
    const input = {
      ok: true,
      url: 'https://example.com/post',
      title: 'Example Post',
      content: 'x'.repeat(1200),
      contentType: 'text/html'
    };

    const out = summarizeToolResult('web_fetch', input, 200);
    expect(out.ok).toBe(true);
    expect(out.tool).toBe('web_fetch');
    expect(out.url).toBe('https://example.com/post');
    expect(out.title).toContain('Example Post');
    expect(typeof out.content).toBe('string');
  });

  it('preserves structured file evidence for file_search and file_grep', () => {
    const searchOut = summarizeToolResult('file_search', {
      ok: true,
      root: '/home/corp-unum/openunum',
      pattern: '*.mjs',
      count: 25,
      truncated: false,
      files: Array.from({ length: 15 }, (_, i) => `/home/corp-unum/openunum/src/core/file-${i}.mjs`)
    }, 200);
    const grepOut = summarizeToolResult('file_grep', {
      ok: true,
      search: 'meta_harness_review',
      pattern: '*.mjs',
      totalMatches: 12,
      truncated: false,
      matches: Array.from({ length: 12 }, (_, i) => ({
        file: `/home/corp-unum/openunum/src/core/file-${i}.mjs`,
        lineNum: i + 1,
        line: `meta_harness_review_${i}`
      }))
    }, 200);

    expect(Array.isArray(searchOut.files)).toBe(true);
    expect(searchOut.files.length).toBeGreaterThan(0);
    expect(Array.isArray(grepOut.matches)).toBe(true);
    expect(grepOut.matches[0].file).toContain('/src/core/file-0.mjs');
  });

  it('keeps enough file evidence for recovery synthesis after truncation', () => {
    const fileSearch = summarizeToolResult('file_search', {
      ok: true,
      root: '/home/corp-unum/openunum',
      pattern: '*',
      count: 40,
      truncated: false,
      files: [
        '/home/corp-unum/openunum/src/core/autonomy-nudges.mjs',
        '/home/corp-unum/openunum/docs/MODEL_AWARE_CONTROLLER.md',
        ...Array.from({ length: 20 }, (_, i) => `/home/corp-unum/openunum/src/core/extra-${i}.mjs`)
      ]
    }, 200);
    const fileGrep = summarizeToolResult('file_grep', {
      ok: true,
      search: 'meta.*harness',
      pattern: '*.mjs',
      totalMatches: 8,
      truncated: false,
      matches: [
        {
          file: '/home/corp-unum/openunum/src/core/autonomy-nudges.mjs',
          lineNum: 42,
          line: 'meta_harness_review'
        },
        ...Array.from({ length: 10 }, (_, i) => ({
          file: `/home/corp-unum/openunum/tests/unit/extra-${i}.test.mjs`,
          lineNum: i + 1,
          line: 'meta_harness_review'
        }))
      ]
    }, 200);

    const result = synthesizeToolOnlyAnswer({
      userMessage: 'How is meta harness is working for openunum ?',
      executedTools: [
        { name: 'file_search', result: fileSearch },
        { name: 'file_grep', result: fileGrep }
      ],
      toolRuns: 2
    });

    expect(result).toContain('meta harness');
    expect(result).not.toContain('Status: ok');
    expect(result).not.toContain('Best next steps from current evidence');
  });
});
