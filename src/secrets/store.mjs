import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const SECRET_STORE_CONTRACT_VERSION = '2026-04-01.secret-store.v1';
export const AUTH_CATALOG_CONTRACT_VERSION = '2026-04-01.auth-catalog.v1';

export const SECRET_FIELD_LABELS = {
  openrouterApiKey: 'OpenRouter API Key',
  nvidiaApiKey: 'NVIDIA API Key',
  openaiApiKey: 'OpenAI API Key',
  openaiOauthToken: 'OpenAI OAuth Token',
  githubToken: 'GitHub Token',
  copilotGithubToken: 'GitHub Copilot Token',
  huggingfaceApiKey: 'HuggingFace API Key',
  elevenlabsApiKey: 'ElevenLabs API Key',
  telegramBotToken: 'Telegram Bot Token'
};

export const AUTH_TARGET_DEFS = [
  { id: 'openrouterApiKey', display_name: 'OpenRouter', category: 'provider', auth_kind: 'api_key' },
  { id: 'nvidiaApiKey', display_name: 'NVIDIA', category: 'provider', auth_kind: 'api_key' },
  { id: 'openaiApiKey', display_name: 'OpenAI', category: 'provider', auth_kind: 'api_key' },
  { id: 'openaiOauthToken', display_name: 'OpenAI OAuth', category: 'integration', auth_kind: 'oauth_token' },
  { id: 'githubToken', display_name: 'GitHub API', category: 'integration', auth_kind: 'token_or_oauth' },
  { id: 'copilotGithubToken', display_name: 'GitHub Copilot', category: 'integration', auth_kind: 'token' },
  { id: 'huggingfaceApiKey', display_name: 'HuggingFace', category: 'integration', auth_kind: 'api_key' },
  { id: 'elevenlabsApiKey', display_name: 'ElevenLabs', category: 'integration', auth_kind: 'api_key' },
  { id: 'telegramBotToken', display_name: 'Telegram', category: 'integration', auth_kind: 'bot_token' }
];

const SECRET_FILE_MODE = 0o600;

function getHomeDir() {
  return process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
}

export function getSecretsPath() {
  return path.join(getHomeDir(), 'secrets.json');
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
      openaiApiKey: '',
      openaiOauthToken: '',
      githubToken: '',
      copilotGithubToken: '',
      huggingfaceApiKey: '',
      elevenlabsApiKey: '',
      telegramBotToken: ''
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
    }
  };
}

export function loadSecretStore() {
  ensureSecretHome();
  const secretPath = getSecretsPath();
  if (!fs.existsSync(secretPath)) return defaultSecrets();
  try {
    return withSecretDefaults(JSON.parse(fs.readFileSync(secretPath, 'utf8')));
  } catch {
    return defaultSecrets();
  }
}

export function saveSecretStore(store) {
  ensureSecretHome();
  const secretPath = getSecretsPath();
  const next = withSecretDefaults(store);
  next.contract_version = SECRET_STORE_CONTRACT_VERSION;
  next.updated_at = new Date().toISOString();
  fs.writeFileSync(secretPath, JSON.stringify(next, null, 2), { mode: SECRET_FILE_MODE });
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

function collectOpenClawAuthProfiles() {
  const root = '/home/corp-unum/.openclaw/agents';
  if (!fs.existsSync(root)) return [];
  const entries = [];
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
  return entries;
}

export function getOpenClawOauthStatus() {
  const profiles = collectOpenClawAuthProfiles().filter((entry) => entry.provider === 'openai-codex' && entry.type === 'oauth');
  const now = Date.now();
  const active = profiles
    .filter((entry) => entry.access && (!entry.expires || entry.expires > now))
    .sort((a, b) => (b.expires || 0) - (a.expires || 0))[0] || null;
  return {
    available: fs.existsSync('/home/corp-unum/.local/bin/openclaw') || Boolean(execCapture('which openclaw').ok),
    active,
    profiles
  };
}

export function scanLocalAuthSources() {
  const secrets = {};
  const providerBaseUrls = {};
  const sourceMap = {};
  const filesScanned = [];

  const openClawConfigPath = '/home/corp-unum/.openclaw/openclaw.json';
  const openClaw = readJson(openClawConfigPath);
  if (openClaw) {
    filesScanned.push(openClawConfigPath);
    setIfMissing(secrets, 'nvidiaApiKey', openClaw?.models?.providers?.nvidia?.apiKey, `${openClawConfigPath}:models.providers.nvidia.apiKey`, sourceMap);
    setIfMissing(providerBaseUrls, 'nvidiaBaseUrl', openClaw?.models?.providers?.nvidia?.baseUrl, `${openClawConfigPath}:models.providers.nvidia.baseUrl`, sourceMap);
    setIfMissing(secrets, 'openrouterApiKey', openClaw?.models?.providers?.openrouter?.apiKey, `${openClawConfigPath}:models.providers.openrouter.apiKey`, sourceMap);
    setIfMissing(providerBaseUrls, 'openrouterBaseUrl', openClaw?.models?.providers?.openrouter?.baseUrl, `${openClawConfigPath}:models.providers.openrouter.baseUrl`, sourceMap);
    setIfMissing(secrets, 'openaiApiKey', openClaw?.models?.providers?.openai?.apiKey, `${openClawConfigPath}:models.providers.openai.apiKey`, sourceMap);
    setIfMissing(providerBaseUrls, 'openaiBaseUrl', openClaw?.models?.providers?.openai?.baseUrl, `${openClawConfigPath}:models.providers.openai.baseUrl`, sourceMap);
    setIfMissing(providerBaseUrls, 'ollamaBaseUrl', openClaw?.models?.providers?.ollama?.baseUrl, `${openClawConfigPath}:models.providers.ollama.baseUrl`, sourceMap);
  }

  const envCandidates = [
    '/home/corp-unum/.openclaw/workspace/.runtime-secrets.env',
    '/home/corp-unum/.openclaw/workspace/.env.trading_agent',
    '/home/corp-unum/openclaw/.env',
    '/home/corp-unum/.openclaw/.env',
    '/home/corp-unum/openclaw-tradebot/.env',
    '/home/corp-unum/openunumQwen/.env'
  ];
  for (const filePath of envCandidates) {
    if (!fs.existsSync(filePath)) continue;
    filesScanned.push(filePath);
    const env = parseEnvFile(filePath);
    setIfMissing(secrets, 'openrouterApiKey', env.OPENROUTER_API_KEY, `${filePath}:OPENROUTER_API_KEY`, sourceMap);
    setIfMissing(secrets, 'nvidiaApiKey', env.NVIDIA_API_KEY || env.NVIDIA_NIM_API_KEY, `${filePath}:NVIDIA_API_KEY`, sourceMap);
    setIfMissing(secrets, 'openaiApiKey', env.OPENAI_API_KEY || env.GENERIC_API_KEY, `${filePath}:OPENAI_API_KEY`, sourceMap);
    setIfMissing(secrets, 'openaiOauthToken', env.OPENAI_OAUTH_TOKEN, `${filePath}:OPENAI_OAUTH_TOKEN`, sourceMap);
    setIfMissing(secrets, 'githubToken', env.GITHUB_TOKEN, `${filePath}:GITHUB_TOKEN`, sourceMap);
    setIfMissing(secrets, 'copilotGithubToken', env.COPILOT_GITHUB_TOKEN, `${filePath}:COPILOT_GITHUB_TOKEN`, sourceMap);
    setIfMissing(secrets, 'huggingfaceApiKey', env.HF_TOKEN || env.HUGGINGFACE_API_KEY, `${filePath}:HF_TOKEN`, sourceMap);
    setIfMissing(secrets, 'elevenlabsApiKey', env.ELEVENLABS_API_KEY, `${filePath}:ELEVENLABS_API_KEY`, sourceMap);
    setIfMissing(secrets, 'telegramBotToken', env.TELEGRAM_BOT_TOKEN, `${filePath}:TELEGRAM_BOT_TOKEN`, sourceMap);
    setIfMissing(providerBaseUrls, 'ollamaBaseUrl', env.OLLAMA_BASE_URL, `${filePath}:OLLAMA_BASE_URL`, sourceMap);
    setIfMissing(providerBaseUrls, 'openrouterBaseUrl', env.OPENROUTER_BASE_URL, `${filePath}:OPENROUTER_BASE_URL`, sourceMap);
    setIfMissing(providerBaseUrls, 'nvidiaBaseUrl', env.NVIDIA_BASE_URL, `${filePath}:NVIDIA_BASE_URL`, sourceMap);
    setIfMissing(providerBaseUrls, 'openaiBaseUrl', env.OPENAI_BASE_URL || env.GENERIC_BASE_URL, `${filePath}:OPENAI_BASE_URL`, sourceMap);
  }

  const envSource = 'process.env';
  setIfMissing(secrets, 'openrouterApiKey', process.env.OPENROUTER_API_KEY, `${envSource}:OPENROUTER_API_KEY`, sourceMap);
  setIfMissing(secrets, 'nvidiaApiKey', process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY, `${envSource}:NVIDIA_API_KEY`, sourceMap);
  setIfMissing(secrets, 'openaiApiKey', process.env.OPENAI_API_KEY || process.env.GENERIC_API_KEY, `${envSource}:OPENAI_API_KEY`, sourceMap);
  setIfMissing(secrets, 'openaiOauthToken', process.env.OPENAI_OAUTH_TOKEN, `${envSource}:OPENAI_OAUTH_TOKEN`, sourceMap);
  setIfMissing(secrets, 'githubToken', process.env.GITHUB_TOKEN, `${envSource}:GITHUB_TOKEN`, sourceMap);
  setIfMissing(secrets, 'copilotGithubToken', process.env.COPILOT_GITHUB_TOKEN, `${envSource}:COPILOT_GITHUB_TOKEN`, sourceMap);
  setIfMissing(secrets, 'huggingfaceApiKey', process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY, `${envSource}:HF_TOKEN`, sourceMap);
  setIfMissing(secrets, 'elevenlabsApiKey', process.env.ELEVENLABS_API_KEY, `${envSource}:ELEVENLABS_API_KEY`, sourceMap);
  setIfMissing(secrets, 'telegramBotToken', process.env.TELEGRAM_BOT_TOKEN, `${envSource}:TELEGRAM_BOT_TOKEN`, sourceMap);
  setIfMissing(providerBaseUrls, 'ollamaBaseUrl', process.env.OLLAMA_BASE_URL, `${envSource}:OLLAMA_BASE_URL`, sourceMap);
  setIfMissing(providerBaseUrls, 'openrouterBaseUrl', process.env.OPENROUTER_BASE_URL, `${envSource}:OPENROUTER_BASE_URL`, sourceMap);
  setIfMissing(providerBaseUrls, 'nvidiaBaseUrl', process.env.NVIDIA_BASE_URL, `${envSource}:NVIDIA_BASE_URL`, sourceMap);
  setIfMissing(providerBaseUrls, 'openaiBaseUrl', process.env.OPENAI_BASE_URL || process.env.GENERIC_BASE_URL, `${envSource}:OPENAI_BASE_URL`, sourceMap);

  const openClawOauth = getOpenClawOauthStatus();
  for (const entry of openClawOauth.profiles) {
    if (!filesScanned.includes(entry.filePath)) filesScanned.push(entry.filePath);
  }
  if (openClawOauth.active) {
    setIfMissing(
      secrets,
      'openaiOauthToken',
      openClawOauth.active.access,
      `${openClawOauth.active.filePath}:${openClawOauth.active.profileId}`,
      sourceMap
    );
  }

  return { secrets, providerBaseUrls, sourceMap, filesScanned };
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
  merged.model.openaiApiKey = String(secrets.openaiApiKey || process.env.OPENAI_API_KEY || process.env.GENERIC_API_KEY || merged.model.openaiApiKey || merged.model.genericApiKey || '').trim();
  merged.model.genericApiKey = merged.model.openaiApiKey;
  merged.channels.telegram.botToken = String(secrets.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || merged.channels.telegram.botToken || '').trim();
  return merged;
}

export function migrateLegacySecretsFromConfig(config = {}) {
  const legacy = {
    openrouterApiKey: config?.model?.openrouterApiKey || '',
    nvidiaApiKey: config?.model?.nvidiaApiKey || '',
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
  const openClawOauth = getOpenClawOauthStatus();
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
      source: openClawOauth.active?.filePath || null
    }
  };
}
