import { describe, expect, it } from 'vitest';
import { summarizeToolResult } from '../../src/core/tool-result-summarizer.mjs';

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
});
