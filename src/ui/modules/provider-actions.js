export function buildProviderAuthCatalogPayload({
  row = {},
  secretField = '',
  baseField = '',
  baseInputValue = '',
  secretInputValue = ''
} = {}) {
  const providerBaseUrls = {};
  if (baseField) providerBaseUrls[baseField] = String(baseInputValue || '').trim() || row.base_url || '';
  const secret = String(secretInputValue || '').trim();
  return {
    providerBaseUrls,
    secrets: secretField && secret ? { [secretField]: secret } : {}
  };
}

export function buildProviderTestRequest({
  provider = '',
  row = {},
  baseInputValue = '',
  secretInputValue = ''
} = {}) {
  return {
    provider,
    baseUrl: String(baseInputValue || '').trim() || row.base_url || '',
    apiKey: String(secretInputValue || '').trim() || ''
  };
}

export function buildServiceSavePayload({
  service = '',
  secretField = '',
  secret = '',
  clientId = '',
  clientSecret = '',
  scopes = ''
} = {}) {
  if (service === 'google-workspace') {
    const payload = {
      oauthConfig: {
        googleWorkspace: {
          clientId: String(clientId || '').trim(),
          scopes: String(scopes || '').trim()
        }
      }
    };
    const trimmedSecret = String(clientSecret || '').trim();
    if (trimmedSecret) payload.oauthConfig.googleWorkspace.clientSecret = trimmedSecret;
    return payload;
  }
  if (!secretField) return null;
  return { secrets: { [secretField]: String(secret || '').trim() } };
}

export function buildServiceTestRequest({ service = '', secret = '' } = {}) {
  return { service, secret: String(secret || '').trim() };
}

export function formatProviderTestStatus(provider, out = {}) {
  return out.ok
    ? `test ok ${provider} | models=${Number(out.modelCount || 0)} | top=${out.topModel || '-'}`
    : `test failed ${provider} | ${out.error || 'unknown'}`;
}

export function formatServiceTestStatus(service, out = {}) {
  return out.ok
    ? `test ok ${service}${out.account ? ` | ${out.account}` : ''}${out.modelCount ? ` | models=${Number(out.modelCount)}` : ''}`
    : `test failed ${service} | ${out.error || out.detail || 'unknown'}`;
}
