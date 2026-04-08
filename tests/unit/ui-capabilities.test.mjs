import { describe, it, expect } from 'vitest';
import { normalizeServiceCapabilityIds } from '../../src/ui/modules/capabilities.js';

describe('ui capabilities helpers', () => {
  it('maps capability service field keys to canonical service ids', () => {
    const out = normalizeServiceCapabilityIds(
      ['githubtoken', 'openaioauthtoken', 'telegrambottoken'],
      ['github', 'google-workspace', 'telegram', 'openai-oauth']
    );
    expect(out).toContain('github');
    expect(out).toContain('openai-oauth');
    expect(out).toContain('telegram');
    expect(out).toContain('google-workspace');
  });

  it('keeps canonical ids and removes unknown provider-secret keys', () => {
    const out = normalizeServiceCapabilityIds(
      ['openrouterapikey', 'nvidiaapikey', 'githubtoken', 'google-workspace'],
      ['github', 'google-workspace']
    );
    expect(out).toEqual(['github', 'google-workspace']);
  });
});
