import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

export const SECRET_STORE_CONTRACT_VERSION = '2026-04-08.secret-store.v2';
export const AUTH_CATALOG_CONTRACT_VERSION = '2026-04-01.auth-catalog.v1';

export const SECRET_FIELD_LABELS = {
  openrouterApiKey: 'OpenRouter API Key',
  nvidiaApiKey: 'NVIDIA API Key',
  xiaomimimoApiKey: 'XiaomiMimo API Key',
  openaiApiKey: 'OpenAI API Key',
  openaiOauthToken: 'OpenAI OAuth Token',
  githubToken: 'GitHub Token',
  copilotGithubToken: 'GitHub Copilot Token',
  huggingfaceApiKey: 'HuggingFace API Key',
  elevenlabsApiKey: 'ElevenLabs API Key',
  telegramBotToken: 'Telegram Bot Token'
};

export const GOOGLE_WORKSPACE_DEFAULT_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/calendar.readonly'
];

export const AUTH_TARGET_DEFS = [
  { id: 'openrouterApiKey', display_name: 'OpenRouter', category: 'provider', auth_kind: 'api_key' },
  { id: 'nvidiaApiKey', display_name: 'NVIDIA', category: 'provider', auth_kind: 'api_key' },
  { id: 'xiaomimimoApiKey', display_name: 'XiaomiMimo', category: 'provider', auth_kind: 'api_key' },
  { id: 'openaiApiKey', display_name: 'OpenAI', category: 'provider', auth_kind: 'api_key' },
  { id: 'openaiOauthToken', display_name: 'OpenAI OAuth', category: 'integration', auth_kind: 'oauth_token' },
  { id: 'githubToken', display_name: 'GitHub API', category: 'integration', auth_kind: 'token_or_oauth' },
  { id: 'copilotGithubToken', display_name: 'GitHub Copilot', category: 'integration', auth_kind: 'token' },
  { id: 'huggingfaceApiKey', display_name: 'HuggingFace', category: 'integration', auth_kind: 'api_key' },
  { id: 'elevenlabsApiKey', display_name: 'ElevenLabs', category: 'integration', auth_kind: 'api_key' },
  { id: 'telegramBotToken', display_name: 'Telegram', category: 'integration', auth_kind: 'bot_token' }
];

const SECRET_FILE_MODE = 0o600;
const SECRET_BACKEND_PLAINTEXT = 'plaintext';
const SECRET_BACKEND_PASSPHRASE = 'passphrase';

function getHomeDir() {
  return process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
}

function getPlainSecretsPath() {
  return path.join(getHomeDir(), 'secrets.json');
}

function getEncryptedSecretsPath() {
  return path.join(getHomeDir(), 'secrets.enc.json');
}

function resolveSecretBackend() {
  const configured = String(process.env.OPENUNUM_SECRETS_BACKEND || '').trim().toLowerCase();
  if (configured === SECRET_BACKEND_PASSPHRASE) return SECRET_BACKEND_PASSPHRASE;
  if (configured === SECRET_BACKEND_PLAINTEXT) return SECRET_BACKEND_PLAINTEXT;
  if (String(process.env.OPENUNUM_SECRETS_PASSPHRASE || '').trim()) return SECRET_BACKEND_PASSPHRASE;
  return SECRET_BACKEND_PLAINTEXT;
}

function getPassphrase() {
  return String(process.env.OPENUNUM_SECRETS_PASSPHRASE || '').trim();
}

function isEncryptedEnvelope(raw = {}) {
  return raw?.storage?.backend === SECRET_BACKEND_PASSPHRASE && typeof raw?.ciphertext === 'string';
}

function deriveKey(passphrase, saltB64) {
  const salt = Buffer.from(saltB64, 'base64');
  return crypto.scryptSync(passphrase, salt, 32);
}

function encryptStorePayload(store, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(store), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    contract_version: SECRET_STORE_CONTRACT_VERSION,
    updated_at: new Date().toISOString(),
    storage: {
      backend: SECRET_BACKEND_PASSPHRASE,
      cipher: 'aes-256-gcm',
      kdf: 'scrypt',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64')
    },
    ciphertext: ciphertext.toString('base64')
  };
}

function decryptStoreEnvelope(envelope, passphrase) {
  const key = deriveKey(passphrase, envelope.storage.salt);
  const iv = Buffer.from(envelope.storage.iv, 'base64');
  const tag = Buffer.from(envelope.storage.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted);
}

export function getSecretsPath() {
  return resolveSecretBackend() === SECRET_BACKEND_PASSPHRASE
    ? getEncryptedSecretsPath()
    : getPlainSecretsPath();
}

export function getSecretStoreStatus() {
  const backend = resolveSecretBackend();
  const pathActive = getSecretsPath();
  const pathPlain = getPlainSecretsPath();
  const pathEncrypted = getEncryptedSecretsPath();
  const hasPassphrase = Boolean(getPassphrase());
  const hasPlain = fs.existsSync(pathPlain);
  const hasEncrypted = fs.existsSync(pathEncrypted);
  const locked = backend === SECRET_BACKEND_PASSPHRASE && !hasPassphrase;
  return {
    backend,
    path: pathActive,
    hasPassphrase,
    locked,
    files: {
      plaintext: hasPlain,
      encrypted: hasEncrypted
    }
  };
}

function ensureSecretHome() {
  fs.mkdirSync(getHomeDir(), { recursive: true });
}

function defaultSecrets() {
  return {
    contract_version: SECRET_STORE_CONTRACT_VERSION,
    updated_at: null,
    secrets: {
      openrouterApiKey: '',
      nvidiaApiKey: '',
      xiaomimimoApiKey: '',
      openaiApiKey: '',
      openaiOauthToken: '',
      githubToken: '',
      copilotGithubToken: '',
      huggingfaceApiKey: '',
      elevenlabsApiKey: '',
      telegramBotToken: ''
    },
    oauth: {
      openaiCodex: {
        access: '',
        refresh: '',
        expires: 0,
        accountId: '',
        email: '',
        source: 'openunum'
      },
      googleWorkspace: {
        access: '',
        refresh: '',
        expires: 0,
        email: '',
        scope: '',
        tokenType: 'Bearer',
        source: 'openunum'
      }
    },
    oauthConfig: {
      googleWorkspace: {
        clientId: '',
        clientSecret: '',
        scopes: GOOGLE_WORKSPACE_DEFAULT_SCOPES.join(' ')
      }
    }
  };
}

function withSecretDefaults(store = {}) {
  const base = defaultSecrets();
  return {
    ...base,
    ...store,
    secrets: {
      ...base.secrets,
      ...(store.secrets || {})
    },
    oauth: {
      ...base.oauth,
      ...(store.oauth || {}),
      openaiCodex: {
        ...base.oauth.openaiCodex,
        ...(store.oauth?.openaiCodex || {})
      },
      googleWorkspace: {
        ...base.oauth.googleWorkspace,
        ...(store.oauth?.googleWorkspace || {})
      }
    },
    oauthConfig: {
      ...base.oauthConfig,
      ...(store.oauthConfig || {}),
      googleWorkspace: {
        ...base.oauthConfig.googleWorkspace,
        ...(store.oauthConfig?.googleWorkspace || {})
      }
    }
  };
}

export function loadSecretStore() {
  ensureSecretHome();
  const backend = resolveSecretBackend();
  const plainPath = getPlainSecretsPath();
  const encryptedPath = getEncryptedSecretsPath();

  if (backend === SECRET_BACKEND_PASSPHRASE) {
    const passphrase = getPassphrase();
    if (!passphrase) {
      return withSecretDefaults({ __storeMeta: { backend, locked: true, path: encryptedPath } });
    }
    if (fs.existsSync(encryptedPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(encryptedPath, 'utf8'));
        if (!isEncryptedEnvelope(raw)) return defaultSecrets();
        const parsed = decryptStoreEnvelope(raw, passphrase);
        return withSecretDefaults({
          ...parsed,
          __storeMeta: { backend, locked: false, path: encryptedPath }
        });
      } catch {
        return withSecretDefaults({ __storeMeta: { backend, locked: true, path: encryptedPath } });
      }
    }
    if (fs.existsSync(plainPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(plainPath, 'utf8'));
        return withSecretDefaults({
          ...parsed,
          __storeMeta: { backend, locked: false, path: plainPath, migrationPending: true }
        });
      } catch {
        return defaultSecrets();
      }
    }
    return withSecretDefaults({ __storeMeta: { backend, locked: false, path: encryptedPath } });
  }

  if (!fs.existsSync(plainPath)) return defaultSecrets();
  try {
    return withSecretDefaults(JSON.parse(fs.readFileSync(plainPath, 'utf8')));
  } catch {
    return defaultSecrets();
  }
}

export function saveSecretStore(store) {
  ensureSecretHome();
  const secretPath = getSecretsPath();
  const next = withSecretDefaults(store);
  delete next.__storeMeta;
  next.contract_version = SECRET_STORE_CONTRACT_VERSION;
  next.updated_at = new Date().toISOString();

  if (resolveSecretBackend() === SECRET_BACKEND_PASSPHRASE) {
    const passphrase = getPassphrase();
    if (!passphrase) {
      throw new Error('secrets_passphrase_missing');
    }
    const envelope = encryptStorePayload(next, passphrase);
    fs.writeFileSync(secretPath, JSON.stringify(envelope, null, 2), { mode: SECRET_FILE_MODE });
    const plainPath = getPlainSecretsPath();
    if (fs.existsSync(plainPath) && process.env.OPENUNUM_SECRETS_KEEP_PLAINTEXT !== '1') {
      try { fs.unlinkSync(plainPath); } catch {}
    }
  } else {
    fs.writeFileSync(secretPath, JSON.stringify(next, null, 2), { mode: SECRET_FILE_MODE });
  }
  try {
    fs.chmodSync(secretPath, SECRET_FILE_MODE);
  } catch {
    // best effort
  }
  return next;
}

export function secretPreview(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length <= 8) return `${raw.slice(0, 2)}***${raw.slice(-1)}`;
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

export function getStoredOpenAICodexOAuth(store = loadSecretStore()) {
  const oauth = store?.oauth?.openaiCodex || {};
  const access = String(oauth.access || '').trim();
  const refresh = String(oauth.refresh || '').trim();
  const expires = Number(oauth.expires || 0) || 0;
  const accountId = String(oauth.accountId || '').trim();
  const email = String(oauth.email || '').trim();
  const source = String(oauth.source || 'openunum').trim();
  if (!access || !refresh) return null;
  return { access, refresh, expires, accountId, email, source };
}

export function saveOpenAICodexOAuth(credentials = {}) {
  const current = loadSecretStore();
  const next = withSecretDefaults(current);
  next.oauth.openaiCodex = {
    access: String(credentials.access || '').trim(),
    refresh: String(credentials.refresh || '').trim(),
    expires: Number(credentials.expires || 0) || 0,
    accountId: String(credentials.accountId || '').trim(),
    email: String(credentials.email || '').trim(),
    source: String(credentials.source || 'openunum').trim()
  };
  if (next.oauth.openaiCodex.access) {
    next.secrets.openaiOauthToken = next.oauth.openaiCodex.access;
  }
  return saveSecretStore(next);
}

export function clearOpenAICodexOAuth() {
  const current = loadSecretStore();
  const next = withSecretDefaults(current);
  next.oauth.openaiCodex = {
    access: '',
    refresh: '',
    expires: 0,
    accountId: '',
    email: '',
    source: 'openunum'
  };
  next.secrets.openaiOauthToken = '';
  return saveSecretStore(next);
}

export function getStoredGoogleWorkspaceOAuth(store = loadSecretStore()) {
  const oauth = store?.oauth?.googleWorkspace || {};
  const access = String(oauth.access || '').trim();
  const refresh = String(oauth.refresh || '').trim();
  const expires = Number(oauth.expires || 0) || 0;
  const email = String(oauth.email || '').trim();
  const scope = String(oauth.scope || '').trim();
  const tokenType = String(oauth.tokenType || 'Bearer').trim() || 'Bearer';
  const source = String(oauth.source || 'openunum').trim();
  if (!access || !refresh) return null;
  return { access, refresh, expires, email, scope, tokenType, source };
}

export function saveGoogleWorkspaceOAuth(credentials = {}) {
  const current = loadSecretStore();
  const next = withSecretDefaults(current);
  next.oauth.googleWorkspace = {
    access: String(credentials.access || '').trim(),
    refresh: String(credentials.refresh || '').trim(),
    expires: Number(credentials.expires || 0) || 0,
    email: String(credentials.email || '').trim(),
    scope: String(credentials.scope || '').trim(),
    tokenType: String(credentials.tokenType || 'Bearer').trim() || 'Bearer',
    source: String(credentials.source || 'openunum').trim()
  };
  return saveSecretStore(next);
}

export function clearGoogleWorkspaceOAuth() {
  const current = loadSecretStore();
  const next = withSecretDefaults(current);
  next.oauth.googleWorkspace = {
    access: '',
    refresh: '',
    expires: 0,
    email: '',
    scope: '',
    tokenType: 'Bearer',
    source: 'openunum'
  };
  return saveSecretStore(next);
}

export function getGoogleWorkspaceOAuthConfig(store = loadSecretStore()) {
  const cfg = store?.oauthConfig?.googleWorkspace || {};
  const clientId = String(cfg.clientId || '').trim();
  const clientSecret = String(cfg.clientSecret || '').trim();
  const scopes = String(cfg.scopes || GOOGLE_WORKSPACE_DEFAULT_SCOPES.join(' ')).trim() || GOOGLE_WORKSPACE_DEFAULT_SCOPES.join(' ');
  return { clientId, clientSecret, scopes };
}

function parseGoogleWorkspaceOAuthConfigInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!(raw.startsWith('{') || raw.startsWith('['))) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.installed && typeof parsed.installed === 'object') return parsed.installed;
      if (parsed.web && typeof parsed.web === 'object') return parsed.web;
      return parsed;
    }
  } catch {}
  return null;
}

export function normalizeGoogleWorkspaceOAuthConfig(config = {}, current = getGoogleWorkspaceOAuthConfig()) {
  const parsed = parseGoogleWorkspaceOAuthConfigInput(config.clientId);
  const source = parsed || config;
  const nextClientId = source?.client_id ?? source?.clientId ?? config.clientId;
  const nextClientSecret = source?.client_secret ?? source?.clientSecret ?? config.clientSecret;
  const nextScopes = source?.scopes ?? config.scopes;
  return {
    clientId: typeof nextClientId === 'string' && nextClientId.trim()
      ? nextClientId.trim()
      : current.clientId,
    clientSecret: typeof nextClientSecret === 'string'
      ? (nextClientSecret.trim() || current.clientSecret)
      : current.clientSecret,
    scopes: typeof nextScopes === 'string' && nextScopes.trim()
      ? nextScopes.trim()
      : current.scopes
  };
}

export function validateGoogleWorkspaceOAuthConfig(config = {}) {
  const clientId = String(config.clientId || '').trim();
  if (!clientId) {
    return { ok: false, error: 'google_workspace_client_id_missing', prerequisite: 'Save a Google Desktop OAuth Client ID first, then rerun Connect.' };
  }
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    return {
      ok: false,
      error: 'google_workspace_client_id_invalid',
      prerequisite: 'Use a Google OAuth Client ID ending in .apps.googleusercontent.com. API keys and service account IDs will not work.'
    };
  }
  if (clientId.includes('YOUR_CLIENT_ID') || clientId.includes('{') || clientId.includes('}')) {
    return {
      ok: false,
      error: 'google_workspace_client_id_invalid',
      prerequisite: 'The saved Google Client ID is malformed. Paste the actual client ID or the downloaded OAuth JSON.'
    };
  }
  return { ok: true };
}

export function saveGoogleWorkspaceOAuthConfig(config = {}) {
  const current = loadSecretStore();
  const next = withSecretDefaults(current);
  next.oauthConfig.googleWorkspace = normalizeGoogleWorkspaceOAuthConfig(config, getGoogleWorkspaceOAuthConfig(next));
  return saveSecretStore(next);
}

export function getEffectiveGoogleWorkspaceOAuthStatus() {
  const store = loadSecretStore();
  const stored = getStoredGoogleWorkspaceOAuth(store);
  if (stored && (!stored.expires || stored.expires > Date.now())) {
    return {
      source: 'openunum',
      active: {
        ...stored,
        filePath: getSecretsPath(),
        profileId: 'google-workspace:openunum',
        agentId: 'openunum'
      }
    };
  }
  return { source: null, active: stored ? { ...stored, filePath: getSecretsPath(), profileId: 'google-workspace:openunum', agentId: 'openunum' } : null };
}

function setIfMissing(target, key, value, source, sourceMap) {
  const normalized = String(value || '').trim();
  if (!normalized || target[key]) return;
  target[key] = normalized;
  sourceMap[key] = source;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    out[key] = value;
  }
  return out;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function uniquePaths(paths = []) {
  return [...new Set((Array.isArray(paths) ? paths : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function parsePathListEnv(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return [];
  return uniquePaths(raw.split(path.delimiter));
}

function getOpenClawAgentsRoots() {
  const configured = parsePathListEnv('OPENUNUM_OPENCLAW_AGENTS_ROOTS');
  if (configured.length) return configured;
  return [path.join(os.homedir(), '.openclaw', 'agents')];
}

function getOpenClawConfigCandidates() {
  const directPath = String(process.env.OPENUNUM_OPENCLAW_CONFIG_PATH || '').trim();
  if (directPath) return [directPath];
  const home = os.homedir();
  return uniquePaths([
    path.join(home, '.openclaw', 'openclaw.json'),
    path.join(home, 'openclaw', 'openclaw.json')
  ]);
}

function getOpenClawEnvCandidates() {
  const configured = parsePathListEnv('OPENUNUM_AUTH_ENV_FILES');
  if (configured.length) return configured;
  const home = os.homedir();
  return uniquePaths([
    path.join(home, '.openclaw', 'workspace', '.runtime-secrets.env'),
    path.join(home, '.openclaw', 'workspace', '.env.trading_agent'),
    path.join(home, 'openclaw', '.env'),
    path.join(home, '.openclaw', '.env'),
    path.join(home, 'openclaw-tradebot', '.env'),
    path.join(home, 'openunumQwen', '.env')
  ]);
}

function collectOpenClawAuthProfiles() {
  const entries = [];
  for (const root of getOpenClawAgentsRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const agentId of fs.readdirSync(root)) {
      const filePath = path.join(root, agentId, 'agent', 'auth-profiles.json');
      const parsed = readJson(filePath);
      if (!parsed || typeof parsed !== 'object') continue;
      const profiles = parsed.profiles || {};
      for (const [profileId, profile] of Object.entries(profiles)) {
        if (!profile || typeof profile !== 'object') continue;
        entries.push({
          filePath,
          agentId,
          profileId,
          provider: String(profile.provider || '').trim(),
          type: String(profile.type || '').trim(),
          access: String(profile.access || '').trim(),
          refresh: String(profile.refresh || '').trim(),
          expires: Number(profile.expires || 0) || 0,
          email: String(profile.email || '').trim()
        });
      }
    }
  }
  return entries;
}

export function getOpenClawOauthStatus() {
  const profiles = collectOpenClawAuthProfiles().filter((entry) => entry.provider === 'openai-codex' && entry.type === 'oauth');
  const now = Date.now();
  const active = profiles
    .filter((entry) => entry.access && (!entry.expires || entry.expires > now))
    .sort((a, b) => (b.expires || 0) - (a.expires || 0))[0] || null;
  const openclawBinaryPath = String(process.env.OPENUNUM_OPENCLAW_BIN || path.join(os.homedir(), '.local', 'bin', 'openclaw'));
  return {
    available: fs.existsSync(openclawBinaryPath) || Boolean(execCapture('which openclaw').ok),
    active,
    profiles
  };
}

export function getEffectiveOpenAICodexOAuthStatus() {
  const store = loadSecretStore();
  const stored = getStoredOpenAICodexOAuth(store);
  const imported = getOpenClawOauthStatus();
  if (stored && (!stored.expires || stored.expires > Date.now())) {
    return {
      source: 'openunum',
      active: {
        ...stored,
        filePath: getSecretsPath(),
        profileId: 'openai-codex:openunum',
        agentId: 'openunum'
      }
    };
  }
  return {
    source: imported.active ? 'openclaw' : null,
    active: imported.active
  };
}

export function scanLocalAuthSources() {
  const secrets = {};
  const providerBaseUrls = {};
  const oauthConfigs = {};
  const sourceMap = {};
  const filesScanned = [];

  for (const openClawConfigPath of getOpenClawConfigCandidates()) {
    const openClaw = readJson(openClawConfigPath);
    if (!openClaw) continue;
    filesScanned.push(openClawConfigPath);
    setIfMissing(secrets, 'nvidiaApiKey', openClaw?.models?.providers?.nvidia?.apiKey, `${openClawConfigPath}:models.providers.nvidia.apiKey`, sourceMap);
    setIfMissing(providerBaseUrls, 'nvidiaBaseUrl', openClaw?.models?.providers?.nvidia?.baseUrl, `${openClawConfigPath}:models.providers.nvidia.baseUrl`, sourceMap);
    setIfMissing(secrets, 'xiaomimimoApiKey', openClaw?.models?.providers?.xiaomimimo?.apiKey, `${openClawConfigPath}:models.providers.xiaomimimo.apiKey`, sourceMap);
    setIfMissing(providerBaseUrls, 'xiaomimimoBaseUrl', openClaw?.models?.providers?.xiaomimimo?.baseUrl, `${openClawConfigPath}:models.providers.xiaomimimo.baseUrl`, sourceMap);
    setIfMissing(secrets, 'openrouterApiKey', openClaw?.models?.providers?.openrouter?.apiKey, `${openClawConfigPath}:models.providers.openrouter.apiKey`, sourceMap);
    setIfMissing(providerBaseUrls, 'openrouterBaseUrl', openClaw?.models?.providers?.openrouter?.baseUrl, `${openClawConfigPath}:models.providers.openrouter.baseUrl`, sourceMap);
    setIfMissing(secrets, 'openaiApiKey', openClaw?.models?.providers?.openai?.apiKey, `${openClawConfigPath}:models.providers.openai.apiKey`, sourceMap);
    setIfMissing(providerBaseUrls, 'openaiBaseUrl', openClaw?.models?.providers?.openai?.baseUrl, `${openClawConfigPath}:models.providers.openai.baseUrl`, sourceMap);
    setIfMissing(providerBaseUrls, 'ollamaBaseUrl', openClaw?.models?.providers?.ollama?.baseUrl, `${openClawConfigPath}:models.providers.ollama.baseUrl`, sourceMap);
  }

  const envCandidates = getOpenClawEnvCandidates();
  for (const filePath of envCandidates) {
    if (!fs.existsSync(filePath)) continue;
    filesScanned.push(filePath);
    const env = parseEnvFile(filePath);
    setIfMissing(secrets, 'openrouterApiKey', env.OPENROUTER_API_KEY, `${filePath}:OPENROUTER_API_KEY`, sourceMap);
    setIfMissing(secrets, 'nvidiaApiKey', env.NVIDIA_API_KEY || env.NVIDIA_NIM_API_KEY, `${filePath}:NVIDIA_API_KEY`, sourceMap);
    setIfMissing(secrets, 'xiaomimimoApiKey', env.XIAOMIMIMO_API_KEY, `${filePath}:XIAOMIMIMO_API_KEY`, sourceMap);
    setIfMissing(secrets, 'openaiApiKey', env.OPENAI_API_KEY || env.GENERIC_API_KEY, `${filePath}:OPENAI_API_KEY`, sourceMap);
    setIfMissing(secrets, 'openaiOauthToken', env.OPENAI_OAUTH_TOKEN, `${filePath}:OPENAI_OAUTH_TOKEN`, sourceMap);
    setIfMissing(secrets, 'githubToken', env.GITHUB_TOKEN, `${filePath}:GITHUB_TOKEN`, sourceMap);
    setIfMissing(secrets, 'copilotGithubToken', env.COPILOT_GITHUB_TOKEN, `${filePath}:COPILOT_GITHUB_TOKEN`, sourceMap);
    setIfMissing(secrets, 'huggingfaceApiKey', env.HF_TOKEN || env.HUGGINGFACE_API_KEY, `${filePath}:HF_TOKEN`, sourceMap);
    setIfMissing(secrets, 'elevenlabsApiKey', env.ELEVENLABS_API_KEY, `${filePath}:ELEVENLABS_API_KEY`, sourceMap);
    setIfMissing(secrets, 'telegramBotToken', env.TELEGRAM_BOT_TOKEN, `${filePath}:TELEGRAM_BOT_TOKEN`, sourceMap);
    setIfMissing(oauthConfigs, 'googleWorkspaceClientId', env.GOOGLE_WORKSPACE_CLIENT_ID || env.GOOGLE_CLIENT_ID, `${filePath}:GOOGLE_WORKSPACE_CLIENT_ID`, sourceMap);
    setIfMissing(oauthConfigs, 'googleWorkspaceClientSecret', env.GOOGLE_WORKSPACE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET, `${filePath}:GOOGLE_WORKSPACE_CLIENT_SECRET`, sourceMap);
    setIfMissing(oauthConfigs, 'googleWorkspaceScopes', env.GOOGLE_WORKSPACE_SCOPES || env.GOOGLE_SCOPES, `${filePath}:GOOGLE_WORKSPACE_SCOPES`, sourceMap);
    setIfMissing(providerBaseUrls, 'ollamaBaseUrl', env.OLLAMA_BASE_URL, `${filePath}:OLLAMA_BASE_URL`, sourceMap);
    setIfMissing(providerBaseUrls, 'openrouterBaseUrl', env.OPENROUTER_BASE_URL, `${filePath}:OPENROUTER_BASE_URL`, sourceMap);
    setIfMissing(providerBaseUrls, 'nvidiaBaseUrl', env.NVIDIA_BASE_URL, `${filePath}:NVIDIA_BASE_URL`, sourceMap);
    setIfMissing(providerBaseUrls, 'xiaomimimoBaseUrl', env.XIAOMIMIMO_BASE_URL, `${filePath}:XIAOMIMIMO_BASE_URL`, sourceMap);
    setIfMissing(providerBaseUrls, 'openaiBaseUrl', env.OPENAI_BASE_URL || env.GENERIC_BASE_URL, `${filePath}:OPENAI_BASE_URL`, sourceMap);
  }

  const envSource = 'process.env';
  setIfMissing(secrets, 'openrouterApiKey', process.env.OPENROUTER_API_KEY, `${envSource}:OPENROUTER_API_KEY`, sourceMap);
  setIfMissing(secrets, 'nvidiaApiKey', process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY, `${envSource}:NVIDIA_API_KEY`, sourceMap);
  setIfMissing(secrets, 'xiaomimimoApiKey', process.env.XIAOMIMIMO_API_KEY, `${envSource}:XIAOMIMIMO_API_KEY`, sourceMap);
  setIfMissing(secrets, 'openaiApiKey', process.env.OPENAI_API_KEY || process.env.GENERIC_API_KEY, `${envSource}:OPENAI_API_KEY`, sourceMap);
  setIfMissing(secrets, 'openaiOauthToken', process.env.OPENAI_OAUTH_TOKEN, `${envSource}:OPENAI_OAUTH_TOKEN`, sourceMap);
  setIfMissing(secrets, 'githubToken', process.env.GITHUB_TOKEN, `${envSource}:GITHUB_TOKEN`, sourceMap);
  setIfMissing(secrets, 'copilotGithubToken', process.env.COPILOT_GITHUB_TOKEN, `${envSource}:COPILOT_GITHUB_TOKEN`, sourceMap);
  setIfMissing(secrets, 'huggingfaceApiKey', process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY, `${envSource}:HF_TOKEN`, sourceMap);
  setIfMissing(secrets, 'elevenlabsApiKey', process.env.ELEVENLABS_API_KEY, `${envSource}:ELEVENLABS_API_KEY`, sourceMap);
  setIfMissing(secrets, 'telegramBotToken', process.env.TELEGRAM_BOT_TOKEN, `${envSource}:TELEGRAM_BOT_TOKEN`, sourceMap);
  setIfMissing(oauthConfigs, 'googleWorkspaceClientId', process.env.GOOGLE_WORKSPACE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID, `${envSource}:GOOGLE_WORKSPACE_CLIENT_ID`, sourceMap);
  setIfMissing(oauthConfigs, 'googleWorkspaceClientSecret', process.env.GOOGLE_WORKSPACE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET, `${envSource}:GOOGLE_WORKSPACE_CLIENT_SECRET`, sourceMap);
  setIfMissing(oauthConfigs, 'googleWorkspaceScopes', process.env.GOOGLE_WORKSPACE_SCOPES || process.env.GOOGLE_SCOPES, `${envSource}:GOOGLE_WORKSPACE_SCOPES`, sourceMap);
  setIfMissing(providerBaseUrls, 'ollamaBaseUrl', process.env.OLLAMA_BASE_URL, `${envSource}:OLLAMA_BASE_URL`, sourceMap);
  setIfMissing(providerBaseUrls, 'openrouterBaseUrl', process.env.OPENROUTER_BASE_URL, `${envSource}:OPENROUTER_BASE_URL`, sourceMap);
  setIfMissing(providerBaseUrls, 'nvidiaBaseUrl', process.env.NVIDIA_BASE_URL, `${envSource}:NVIDIA_BASE_URL`, sourceMap);
  setIfMissing(providerBaseUrls, 'xiaomimimoBaseUrl', process.env.XIAOMIMIMO_BASE_URL, `${envSource}:XIAOMIMIMO_BASE_URL`, sourceMap);
  setIfMissing(providerBaseUrls, 'openaiBaseUrl', process.env.OPENAI_BASE_URL || process.env.GENERIC_BASE_URL, `${envSource}:OPENAI_BASE_URL`, sourceMap);

  const openClawOauth = getOpenClawOauthStatus();
  for (const entry of openClawOauth.profiles) {
    if (!filesScanned.includes(entry.filePath)) filesScanned.push(entry.filePath);
  }
  const effectiveOpenAiOauth = getEffectiveOpenAICodexOAuthStatus();
  if (effectiveOpenAiOauth.active) {
    setIfMissing(
      secrets,
      'openaiOauthToken',
      effectiveOpenAiOauth.active.access,
      `${effectiveOpenAiOauth.active.filePath}:${effectiveOpenAiOauth.active.profileId}`,
      sourceMap
    );
  }

  const googleConfig = getGoogleWorkspaceOAuthConfig();
  if (googleConfig.clientId) {
    setIfMissing(oauthConfigs, 'googleWorkspaceClientId', googleConfig.clientId, `${getSecretsPath()}:oauthConfig.googleWorkspace.clientId`, sourceMap);
  }
  if (googleConfig.clientSecret) {
    setIfMissing(oauthConfigs, 'googleWorkspaceClientSecret', googleConfig.clientSecret, `${getSecretsPath()}:oauthConfig.googleWorkspace.clientSecret`, sourceMap);
  }
  if (googleConfig.scopes) {
    setIfMissing(oauthConfigs, 'googleWorkspaceScopes', googleConfig.scopes, `${getSecretsPath()}:oauthConfig.googleWorkspace.scopes`, sourceMap);
  }

  return { secrets, providerBaseUrls, oauthConfigs, sourceMap, filesScanned };
}

export function mergeSecrets(currentStore, updates = {}, clear = []) {
  const next = withSecretDefaults(currentStore);
  const clearSet = new Set(Array.isArray(clear) ? clear : []);
  for (const key of Object.keys(next.secrets)) {
    if (clearSet.has(key)) {
      next.secrets[key] = '';
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(updates, key) && typeof updates[key] === 'string') {
      const value = updates[key].trim();
      if (value) next.secrets[key] = value;
    }
  }
  return next;
}

export function scrubSecretsFromConfig(config = {}) {
  const clone = JSON.parse(JSON.stringify(config || {}));
  if (!clone.model) clone.model = {};
  if (!clone.channels) clone.channels = {};
  if (!clone.channels.telegram) clone.channels.telegram = {};
  clone.model.openrouterApiKey = '';
  clone.model.nvidiaApiKey = '';
  clone.model.xiaomimimoApiKey = '';
  clone.model.openaiApiKey = '';
  clone.model.genericApiKey = '';
  clone.channels.telegram.botToken = '';
  return clone;
}

export function applySecretsToConfig(config = {}) {
  const store = loadSecretStore();
  const merged = JSON.parse(JSON.stringify(config || {}));
  if (!merged.model) merged.model = {};
  if (!merged.channels) merged.channels = {};
  if (!merged.channels.telegram) merged.channels.telegram = {};
  const secrets = store.secrets || {};
  merged.model.openrouterApiKey = String(secrets.openrouterApiKey || process.env.OPENROUTER_API_KEY || merged.model.openrouterApiKey || '').trim();
  merged.model.nvidiaApiKey = String(secrets.nvidiaApiKey || process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY || merged.model.nvidiaApiKey || '').trim();
  merged.model.xiaomimimoApiKey = String(secrets.xiaomimimoApiKey || process.env.XIAOMIMIMO_API_KEY || merged.model.xiaomimimoApiKey || '').trim();
  merged.model.openaiApiKey = String(secrets.openaiApiKey || process.env.OPENAI_API_KEY || process.env.GENERIC_API_KEY || merged.model.openaiApiKey || merged.model.genericApiKey || '').trim();
  merged.model.genericApiKey = merged.model.openaiApiKey;
  merged.channels.telegram.botToken = String(secrets.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || merged.channels.telegram.botToken || '').trim();
  return merged;
}

export function migrateLegacySecretsFromConfig(config = {}) {
  const legacy = {
    openrouterApiKey: config?.model?.openrouterApiKey || '',
    nvidiaApiKey: config?.model?.nvidiaApiKey || '',
    xiaomimimoApiKey: config?.model?.xiaomimimoApiKey || '',
    openaiApiKey: config?.model?.openaiApiKey || config?.model?.genericApiKey || '',
    telegramBotToken: config?.channels?.telegram?.botToken || ''
  };
  const hasLegacy = Object.values(legacy).some((value) => String(value || '').trim());
  if (!hasLegacy) return { changed: false, config: scrubSecretsFromConfig(config), store: loadSecretStore() };
  const currentStore = loadSecretStore();
  const nextStore = mergeSecrets(currentStore, legacy);
  saveSecretStore(nextStore);
  return { changed: true, config: scrubSecretsFromConfig(config), store: nextStore };
}

function execCapture(cmd) {
  try {
    return { ok: true, output: execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    return {
      ok: false,
      code: error.status ?? null,
      output: String(error.stderr || error.stdout || error.message || '').trim()
    };
  }
}

export function getCliAuthStatus() {
  const gh = execCapture('gh auth status');
  const ghUser = gh.ok ? (gh.output.match(/Logged in to github\.com account\s+([^\s]+)/i)?.[1] || null) : null;
  const gcloud = execCapture('gcloud auth list --format=json');
  let gcloudActive = null;
  if (gcloud.ok) {
    try {
      const parsed = JSON.parse(gcloud.output || '[]');
      gcloudActive = parsed.find((item) => item.status === 'ACTIVE')?.account || null;
    } catch {
      gcloudActive = null;
    }
  }
  const huggingface = execCapture('huggingface-cli whoami');
  const elevenlabs = execCapture('python3 -m elevenlabs --help');
  const openclawCli = execCapture('openclaw --version');
  const openClawOauth = getEffectiveOpenAICodexOAuthStatus();
  return {
    github: {
      cli: 'gh',
      available: gh.ok || gh.code !== 127,
      authenticated: gh.ok,
      account: ghUser,
      detail: gh.ok ? 'authenticated' : (gh.output || 'not_available')
    },
    googleWorkspace: {
      cli: 'gcloud',
      available: gcloud.ok || gcloud.code !== 127,
      authenticated: Boolean(gcloudActive),
      account: gcloudActive,
      detail: gcloud.ok ? 'authenticated' : (gcloud.output || 'not_available')
    },
    huggingface: {
      cli: 'huggingface-cli',
      available: huggingface.ok || huggingface.code !== 127,
      authenticated: huggingface.ok,
      account: huggingface.ok ? (huggingface.output.split('\n')[0] || null) : null,
      detail: huggingface.ok ? 'authenticated' : (huggingface.output || 'not_available')
    },
    elevenlabs: {
      cli: 'python3 -m elevenlabs',
      available: elevenlabs.ok || !/No module named elevenlabs/.test(elevenlabs.output || ''),
      authenticated: false,
      account: null,
      detail: elevenlabs.ok ? 'cli_available' : (elevenlabs.output || 'not_available')
    },
    openclaw: {
      cli: 'openclaw',
      available: openclawCli.ok || openclawCli.code !== 127,
      authenticated: Boolean(openClawOauth.active),
      account: openClawOauth.active?.email || openClawOauth.active?.agentId || null,
      detail: openClawOauth.active
        ? `oauth profile ${openClawOauth.active.profileId}`
        : (openclawCli.ok ? 'cli_available' : (openclawCli.output || 'not_available')),
      expires: openClawOauth.active?.expires || null,
      source: openClawOauth.active?.filePath || null,
      owner: openClawOauth.source || null
    }
  };
}
