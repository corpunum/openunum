import crypto from 'node:crypto';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function buildGoogleWorkspaceRedirectUri(serverConfig = {}) {
  const host = String(serverConfig.host || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(serverConfig.port || 18880) || 18880;
  return `http://${host}:${port}/oauth/google-workspace/callback`;
}

export function createGoogleWorkspacePkce() {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = crypto.randomUUID();
  return { verifier, challenge, state };
}

export function buildGoogleWorkspaceAuthUrl({
  clientId,
  redirectUri,
  scopes,
  state,
  challenge
}) {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function parseTokenResponse(response) {
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error_description || json.error || `google_oauth_http_${response.status}`);
  }
  return json;
}

export async function exchangeGoogleWorkspaceAuthorizationCode({
  clientId,
  clientSecret,
  code,
  verifier,
  redirectUri
}) {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  return parseTokenResponse(response);
}

export async function refreshGoogleWorkspaceAccessToken({
  clientId,
  clientSecret,
  refreshToken
}) {
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  return parseTokenResponse(response);
}

export async function fetchGoogleWorkspaceUser(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000)
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error_description || json.error || `google_userinfo_http_${response.status}`);
  }
  return json;
}

export async function resolveGoogleWorkspaceAccessToken({ credentials, config, save }) {
  const access = String(credentials?.access || '').trim();
  const refresh = String(credentials?.refresh || '').trim();
  const expires = Number(credentials?.expires || 0) || 0;
  if (!refresh) throw new Error('google_workspace_refresh_missing');
  if (access && expires && expires > Date.now() + 60000) {
    return { accessToken: access, credentials };
  }
  const refreshed = await refreshGoogleWorkspaceAccessToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: refresh
  });
  const nextCredentials = {
    access: String(refreshed.access_token || '').trim(),
    refresh: String(refreshed.refresh_token || refresh).trim(),
    expires: Date.now() + (Number(refreshed.expires_in || 3600) * 1000),
    scope: String(refreshed.scope || credentials?.scope || config.scopes || '').trim(),
    tokenType: String(refreshed.token_type || 'Bearer').trim() || 'Bearer',
    email: String(credentials?.email || '').trim(),
    source: 'openunum'
  };
  if (typeof save === 'function') save(nextCredentials);
  return { accessToken: nextCredentials.access, credentials: nextCredentials };
}
