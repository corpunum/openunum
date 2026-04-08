import { describe, it, expect } from 'vitest';
import {
  buildProviderAuthCatalogPayload,
  buildProviderTestRequest,
  buildServiceSavePayload,
  buildServiceTestRequest,
  formatProviderTestStatus,
  formatServiceTestStatus
} from '../../src/ui/modules/provider-actions.js';

describe('ui provider actions helpers', () => {
  it('builds provider auth payload from row and inputs', () => {
    const out = buildProviderAuthCatalogPayload({
      row: { base_url: 'http://127.0.0.1:11434' },
      secretField: 'openrouterApiKey',
      baseField: 'openrouterBaseUrl',
      baseInputValue: 'https://openrouter.ai/api/v1',
      secretInputValue: 'sk-123'
    });
    expect(out.providerBaseUrls.openrouterBaseUrl).toBe('https://openrouter.ai/api/v1');
    expect(out.secrets.openrouterApiKey).toBe('sk-123');
  });

  it('builds provider test request', () => {
    const out = buildProviderTestRequest({
      provider: 'openrouter',
      row: { base_url: 'https://openrouter.ai/api/v1' },
      baseInputValue: '',
      secretInputValue: 'sk-abc'
    });
    expect(out).toEqual({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-abc'
    });
  });

  it('builds service save payload for google workspace and token services', () => {
    const google = buildServiceSavePayload({
      service: 'google-workspace',
      clientId: 'cid',
      clientSecret: 'sec',
      scopes: 'a b'
    });
    expect(google.oauthConfig.googleWorkspace.clientId).toBe('cid');
    expect(google.oauthConfig.googleWorkspace.clientSecret).toBe('sec');

    const token = buildServiceSavePayload({
      service: 'github',
      secretField: 'githubToken',
      secret: 'ghp_x'
    });
    expect(token).toEqual({ secrets: { githubToken: 'ghp_x' } });
  });

  it('builds service test request and formats status text', () => {
    expect(buildServiceTestRequest({ service: 'github', secret: 'x ' })).toEqual({ service: 'github', secret: 'x' });
    expect(formatProviderTestStatus('openrouter', { ok: true, modelCount: 3, topModel: 'm1' })).toContain('test ok openrouter');
    expect(formatServiceTestStatus('github', { ok: false, error: 'bad_token' })).toContain('bad_token');
  });
});
