import { describe, it, expect } from 'vitest';
import { assessSearchEvidenceQuality, buildSearchBackendChain } from '../../src/tools/search-policy.mjs';

describe('search backend policy', () => {
  it('builds explicit chain for fixed backend', () => {
    const chain = buildSearchBackendChain({ requestedBackend: 'duckduckgo', browserAvailable: true });
    expect(chain).toEqual(['duckduckgo']);
  });

  it('prioritizes model-native, then cdp, then duckduckgo for auto when no API keys are present', () => {
    const chain = buildSearchBackendChain({ requestedBackend: 'auto', browserAvailable: true });
    expect(chain[0]).toBe('model-native');
    expect(chain[1]).toBe('cdp');
    expect(chain).toContain('duckduckgo');
  });

  it('flags duckduckgo challenge pages as low quality', () => {
    const out = assessSearchEvidenceQuality({
      results: [{
        title: 'search at DuckDuckGo',
        url: 'https://duckduckgo.com/?q=test',
        snippet: 'Unfortunately, bots use DuckDuckGo too. Please complete the following challenge'
      }]
    }, { backend: 'cdp', query: 'test' });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('challenge_page_detected');
  });

  it('accepts normal result evidence', () => {
    const out = assessSearchEvidenceQuality({
      results: [{
        title: 'Repo XYZ release',
        url: 'https://github.com/org/repo',
        snippet: 'Open-source repo released in April 2026 with changelog and docs.'
      }]
    }, { backend: 'duckduckgo', query: 'repo april 2026' });
    expect(out.ok).toBe(true);
  });
});
