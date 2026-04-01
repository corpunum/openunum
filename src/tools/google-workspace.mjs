import {
  getEffectiveGoogleWorkspaceOAuthStatus,
  getGoogleWorkspaceOAuthConfig,
  saveGoogleWorkspaceOAuth
} from '../secrets/store.mjs';
import { fetchGoogleWorkspaceUser, resolveGoogleWorkspaceAccessToken } from '../oauth/google-workspace.mjs';

function base64Url(input) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildRawEmail({ to, subject, body, cc, bcc }) {
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8'
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}

function safeObj(obj) {
  return obj && typeof obj === 'object' ? obj : {};
}

function normalizeQuery(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const out = String(value).trim();
  return out.length ? out : null;
}

function buildGoogleApiUrl({ service, resource, method, params = {} }) {
  const s = String(service || '').trim().toLowerCase();
  const r = String(resource || '').trim().toLowerCase();
  const m = String(method || '').trim().toLowerCase();
  let url;
  if (s === 'gmail' && r === 'users' && m === 'messages send') {
    url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  } else if (s === 'gmail' && r === 'users' && m === 'messages list') {
    url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  } else if (s === 'gmail' && r === 'users' && m === 'messages get') {
    const id = String(params.id || '').trim();
    if (!id) throw new Error('id_required');
    url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`;
  } else if (s === 'drive' && r === 'files' && (m === 'list' || m === 'files list')) {
    url = 'https://www.googleapis.com/drive/v3/files';
  } else if (s === 'calendar' && r === 'events' && (m === 'list' || m === 'events list')) {
    const calendarId = String(params.calendarId || 'primary').trim() || 'primary';
    url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  } else {
    throw new Error(`unsupported_google_workspace_call:${s}:${r}:${m}`);
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(safeObj(params))) {
    if (key === 'id' || (s === 'calendar' && key === 'calendarId')) continue;
    const normalized = normalizeQuery(value);
    if (normalized == null) continue;
    if (Array.isArray(normalized)) {
      normalized.forEach((item) => query.append(key, item));
    } else {
      query.set(key, normalized);
    }
  }
  const qs = query.toString();
  return qs ? `${url}?${qs}` : url;
}

export class GoogleWorkspaceClient {
  constructor(config) {
    this.config = config;
  }

  getAuthConfig() {
    return getGoogleWorkspaceOAuthConfig();
  }

  async resolveAuth() {
    const authConfig = this.getAuthConfig();
    if (!authConfig.clientId) {
      throw new Error('google_workspace_client_id_missing');
    }
    const status = getEffectiveGoogleWorkspaceOAuthStatus();
    if (!status.active) {
      throw new Error('google_workspace_oauth_missing');
    }
    const resolved = await resolveGoogleWorkspaceAccessToken({
      credentials: status.active,
      config: authConfig,
      save: (credentials) => saveGoogleWorkspaceOAuth(credentials)
    });
    return {
      accessToken: resolved.accessToken,
      credentials: resolved.credentials,
      config: authConfig
    };
  }

  async status() {
    const authConfig = this.getAuthConfig();
    const status = getEffectiveGoogleWorkspaceOAuthStatus();
    if (!authConfig.clientId) {
      return {
        ok: true,
        installed: false,
        cli: 'openunum',
        authenticated: false,
        detail: 'google_workspace_client_id_missing',
        hint: 'Save a Google OAuth Desktop Client ID in Providers -> Google Workspace, then click Connect.'
      };
    }
    if (!status.active) {
      return {
        ok: true,
        installed: true,
        cli: 'openunum',
        authenticated: false,
        detail: 'oauth_not_connected',
        hint: 'Click Connect to complete Google Workspace OAuth.'
      };
    }
    try {
      const auth = await this.resolveAuth();
      const user = auth.credentials?.email ? { email: auth.credentials.email } : await fetchGoogleWorkspaceUser(auth.accessToken);
      if (!auth.credentials?.email && user?.email) {
        saveGoogleWorkspaceOAuth({ ...auth.credentials, email: user.email });
      }
      return {
        ok: true,
        installed: true,
        cli: 'openunum',
        authenticated: true,
        account: user?.email || auth.credentials?.email || null,
        detail: 'authenticated',
        scopes: String(auth.credentials?.scope || auth.config.scopes || '').trim()
      };
    } catch (error) {
      return {
        ok: true,
        installed: true,
        cli: 'openunum',
        authenticated: false,
        detail: String(error.message || error),
        hint: 'Reconnect Google Workspace OAuth.'
      };
    }
  }

  async authorizedFetch(url, init = {}) {
    const auth = await this.resolveAuth();
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${auth.accessToken}`
      },
      signal: init.signal || AbortSignal.timeout(20000)
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: json?.error?.message || json?.error_description || json?.error || `google_api_http_${response.status}`,
        detail: json
      };
    }
    return { ok: true, status: response.status, data: json };
  }

  async call({ service, resource, method, params = {}, body = null }) {
    const url = buildGoogleApiUrl({ service, resource, method, params });
    const wantsJson = body && typeof body === 'object';
    return this.authorizedFetch(url, {
      method: wantsJson ? 'POST' : 'GET',
      headers: wantsJson ? { 'Content-Type': 'application/json' } : {},
      body: wantsJson ? JSON.stringify(body) : undefined
    });
  }

  async gmailSend({ to, subject, body, cc = '', bcc = '' }) {
    if (!to || !subject || !body) return { ok: false, error: 'to_subject_body_required' };
    const raw = buildRawEmail({ to, subject, body, cc, bcc });
    return this.call({
      service: 'gmail',
      resource: 'users',
      method: 'messages send',
      body: { raw: base64Url(raw) }
    });
  }

  async gmailList({ limit = 10, query = '' }) {
    return this.call({
      service: 'gmail',
      resource: 'users',
      method: 'messages list',
      params: { maxResults: Number(limit) || 10, q: String(query || '') }
    });
  }

  async gmailRead({ id, format = 'full' }) {
    if (!id) return { ok: false, error: 'id_required' };
    return this.call({
      service: 'gmail',
      resource: 'users',
      method: 'messages get',
      params: { id: String(id), format: String(format || 'full') }
    });
  }
}
