import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { loadConfig, saveConfig, defaultConfig } from './config.mjs';
import { MemoryStore } from './memory/store.mjs';
import { OpenUnumAgent } from './core/agent.mjs';
import { MissionRunner } from './core/missions.mjs';
import { SelfHealMonitor } from './core/selfheal.mjs';
import { getAutonomyMaster } from './core/autonomy-master.mjs';
import { estimateMessagesTokens } from './core/context-budget.mjs';
import { resolveExecutionEnvelope } from './core/model-execution-envelope.mjs';
import { CDPBrowser } from './browser/cdp.mjs';
import { logInfo, logError } from './logger.mjs';
import {
  noCacheHeaders,
  parseBody,
  sendApiError as sendApiErrorBase,
  sendJson
} from './server/http.mjs';
import {
  AUTH_CATALOG_CONTRACT_VERSION,
  AUTH_TARGET_DEFS,
  GOOGLE_WORKSPACE_DEFAULT_SCOPES,
  applySecretsToConfig,
  getCliAuthStatus,
  getEffectiveGoogleWorkspaceOAuthStatus,
  getEffectiveOpenAICodexOAuthStatus,
  getGoogleWorkspaceOAuthConfig,
  getSecretsPath,
  getStoredGoogleWorkspaceOAuth,
  getStoredOpenAICodexOAuth,
  loadSecretStore,
  mergeSecrets,
  normalizeGoogleWorkspaceOAuthConfig,
  saveGoogleWorkspaceOAuth,
  saveGoogleWorkspaceOAuthConfig,
  saveSecretStore,
  saveOpenAICodexOAuth,
  scanLocalAuthSources,
  scrubSecretsFromConfig,
  secretPreview,
  validateGoogleWorkspaceOAuthConfig
} from './secrets/store.mjs';
import {
  buildGoogleWorkspaceAuthUrl,
  buildGoogleWorkspaceRedirectUri,
  createGoogleWorkspacePkce,
  exchangeGoogleWorkspaceAuthorizationCode,
  fetchGoogleWorkspaceUser
} from './oauth/google-workspace.mjs';
import {
  MODEL_CATALOG_CONTRACT_VERSION,
  PROVIDER_ORDER,
  buildLegacyProviderModels,
  buildModelCatalog,
  fetchNvidiaModels,
  fetchOllamaModels,
  fetchOpenRouterModels,
  fetchOpenAIModels,
  importProviderSecretsFromOpenClaw,
  normalizeProviderId
} from './models/catalog.mjs';
import { handleHealthRoute } from './server/routes/health.mjs';
import { handleBrowserRoute } from './server/routes/browser.mjs';
import { handleTelegramRoute } from './server/routes/telegram.mjs';
import { handleUiRoute } from './server/routes/ui.mjs';
import { handleSessionsRoute } from './server/routes/sessions.mjs';
import { handleMissionsRoute } from './server/routes/missions.mjs';
import { handleModelRoute } from './server/routes/model.mjs';
import { handleAuthRoute } from './server/routes/auth.mjs';
import { handleConfigRoute } from './server/routes/config.mjs';
import { handleAutonomyRoute } from './server/routes/autonomy.mjs';
import { handleChatToolsRoute } from './server/routes/chat_tools.mjs';
import { handleSkillsResearchRoute } from './server/routes/skills_research.mjs';
import { createAuthJobsService } from './server/services/auth_jobs.mjs';
import { createBrowserRuntimeService } from './server/services/browser_runtime.mjs';
import { createTelegramRuntimeService } from './server/services/telegram_runtime.mjs';
import { createResearchRuntimeService } from './server/services/research_runtime.mjs';
import { createChatRuntimeService } from './server/services/chat_runtime.mjs';

const config = loadConfig();
normalizeModelSettings();
const memory = new MemoryStore();
const agent = new OpenUnumAgent({ config, memoryStore: memory });
const missions = new MissionRunner({ agent, memoryStore: memory, config });
let browser = new CDPBrowser(config.browser?.cdpUrl);
const autonomyMaster = getAutonomyMaster({ config, agent, memoryStore: memory, browser });
const selfHealMonitor = new SelfHealMonitor({ config, agent, browser, memory });
const API_ERROR_CONTRACT_VERSION = '2026-04-02.api-errors.v1';
const TOOL_CATALOG_CONTRACT_VERSION = '2026-04-02.tool-catalog.v1';

const chatRuntime = createChatRuntimeService({
  agent,
  saveConfig: () => saveConfig(config)
});
const pendingChats = chatRuntime.pendingChats;
const withTimeout = chatRuntime.withTimeout;
const getOrStartChat = chatRuntime.getOrStartChat;
const prunePendingChats = chatRuntime.prunePendingChats;

const telegramRuntime = createTelegramRuntimeService({ config, agent, logError });
const runTelegramLoop = telegramRuntime.runTelegramLoop;
const stopTelegramLoop = telegramRuntime.stopTelegramLoop;
const telegramLoopRunning = () => telegramRuntime.isRunning();
const telegramLoopStopRequested = () => telegramRuntime.isStopRequested();

const researchRuntime = createResearchRuntimeService({ config, agent, logInfo, logError });
const startResearchDailyLoop = researchRuntime.startResearchDailyLoop;
const stopResearchDailyLoop = researchRuntime.stopResearchDailyLoop;

const browserRuntime = createBrowserRuntimeService({
  config,
  saveConfig,
  agent,
  CDPBrowser,
  setBrowser: (nextBrowser) => { browser = nextBrowser; }
});
const launchDebugBrowser = browserRuntime.launchDebugBrowser;

const authJobsService = createAuthJobsService({
  config,
  agent,
  getGoogleWorkspaceOAuthConfig,
  validateGoogleWorkspaceOAuthConfig,
  createGoogleWorkspacePkce,
  buildGoogleWorkspaceRedirectUri,
  buildGoogleWorkspaceAuthUrl,
  GOOGLE_WORKSPACE_DEFAULT_SCOPES,
  exchangeGoogleWorkspaceAuthorizationCode,
  fetchGoogleWorkspaceUser,
  saveGoogleWorkspaceOAuth,
  saveOpenAICodexOAuth,
  launchOauthCommand
});
const authJobs = authJobsService.authJobs;
const summarizeAuthJob = authJobsService.summarizeAuthJob;
const startOpenAICodexOAuthJob = authJobsService.startOpenAICodexOAuthJob;
const startGoogleWorkspaceOAuthJob = authJobsService.startGoogleWorkspaceOAuthJob;
const findGoogleWorkspaceAuthJobByState = authJobsService.findGoogleWorkspaceAuthJobByState;
const completeGoogleWorkspaceAuthJob = authJobsService.completeGoogleWorkspaceAuthJob;
const getAuthJob = authJobsService.getAuthJob;
const completeAuthJob = authJobsService.completeAuthJob;

function normalizeModelSettings() {
  config.model.provider = normalizeProviderId(config.model.provider);
  config.model.providerModels = config.model.providerModels || {};
  if (config.model.providerModels.generic && !config.model.providerModels.openai) {
    config.model.providerModels.openai = String(config.model.providerModels.generic).replace(/^generic\//, 'openai/');
  }
  delete config.model.providerModels.generic;
  config.model.openaiBaseUrl = config.model.openaiBaseUrl || config.model.genericBaseUrl || 'https://api.openai.com/v1';
  config.model.openaiApiKey = config.model.openaiApiKey || config.model.genericApiKey || '';
  config.model.genericBaseUrl = config.model.openaiBaseUrl;
  config.model.genericApiKey = config.model.openaiApiKey;
  config.model.model = String(config.model.model || '').replace(/^generic\//, 'openai/');
  config.model.routing = config.model.routing || {};
  config.model.routing.fallbackProviders = (config.model.routing.fallbackProviders || PROVIDER_ORDER)
    .map((provider) => normalizeProviderId(provider))
    .filter((provider, index, arr) => provider && arr.indexOf(provider) === index);
  config.model.behaviorOverrides = config.model.behaviorOverrides || {};
}

function behaviorOverrideKey(provider, model) {
  const p = normalizeProviderId(provider || 'ollama');
  const m = String(model || '').trim().toLowerCase();
  return `${p}::${m}`;
}

function reloadConfigSecrets() {
  const applied = applySecretsToConfig({ model: config.model, channels: config.channels });
  config.model = { ...config.model, ...(applied.model || {}) };
  config.channels = {
    ...(config.channels || {}),
    telegram: {
      ...(config.channels?.telegram || {}),
      ...(applied.channels?.telegram || {})
    }
  };
  normalizeModelSettings();
}

function getProviderConfigPayload() {
  return {
    ollamaBaseUrl: config.model.ollamaBaseUrl,
    openrouterBaseUrl: config.model.openrouterBaseUrl,
    nvidiaBaseUrl: config.model.nvidiaBaseUrl,
    openaiBaseUrl: config.model.openaiBaseUrl || config.model.genericBaseUrl,
    genericBaseUrl: config.model.openaiBaseUrl || config.model.genericBaseUrl,
    hasOpenrouterApiKey: Boolean(config.model.openrouterApiKey),
    hasNvidiaApiKey: Boolean(config.model.nvidiaApiKey),
    hasOpenaiApiKey: Boolean(config.model.openaiApiKey || config.model.genericApiKey),
    hasGenericApiKey: Boolean(config.model.openaiApiKey || config.model.genericApiKey)
  };
}

function persistSecretUpdates(secretUpdates = {}, clear = []) {
  const currentStore = loadSecretStore();
  const nextStore = mergeSecrets(currentStore, secretUpdates, clear);
  saveSecretStore(nextStore);
  reloadConfigSecrets();
  return nextStore;
}

function buildAuthMethodRows(store, scan, cliStatus) {
  const secrets = store.secrets || {};
  const storedOpenAiOauth = getStoredOpenAICodexOAuth(store);
  const effectiveOpenAiOauth = getEffectiveOpenAICodexOAuthStatus();
  const storedGoogleOauth = getStoredGoogleWorkspaceOAuth(store);
  const effectiveGoogleOauth = getEffectiveGoogleWorkspaceOAuthStatus();
  const googleOauthConfig = getGoogleWorkspaceOAuthConfig(store);
  return [
    {
      id: 'github',
      display_name: 'GitHub',
      auth_kind: 'token_or_oauth',
      configured: Boolean(secrets.githubToken || cliStatus.github?.authenticated),
      stored: Boolean(secrets.githubToken),
      stored_preview: secretPreview(secrets.githubToken),
      discovered: Boolean(scan.secrets.githubToken),
      discovered_source: scan.sourceMap.githubToken || null,
      cli: cliStatus.github
    },
    {
      id: 'google-workspace',
      display_name: 'Google Workspace',
      auth_kind: 'oauth_native',
      configured: Boolean(effectiveGoogleOauth.active),
      stored: Boolean(storedGoogleOauth?.access),
      stored_preview: secretPreview(storedGoogleOauth?.access),
      discovered: Boolean(scan.oauthConfigs?.googleWorkspaceClientId),
      discovered_source: scan.sourceMap.googleWorkspaceClientId || null,
      cli: {
        cli: 'openunum',
        available: Boolean(googleOauthConfig.clientId),
        authenticated: Boolean(effectiveGoogleOauth.active),
        account: effectiveGoogleOauth.active?.email || null,
        detail: effectiveGoogleOauth.active
          ? 'authenticated'
          : (googleOauthConfig.clientId ? 'client_id_saved' : 'client_id_missing')
      },
      oauth_client_id: googleOauthConfig.clientId || '',
      oauth_client_id_preview: secretPreview(googleOauthConfig.clientId),
      oauth_client_secret_preview: secretPreview(googleOauthConfig.clientSecret),
      oauth_scopes: googleOauthConfig.scopes
    },
    {
      id: 'huggingface',
      display_name: 'HuggingFace',
      auth_kind: 'api_key_or_cli',
      configured: Boolean(secrets.huggingfaceApiKey || cliStatus.huggingface?.authenticated),
      stored: Boolean(secrets.huggingfaceApiKey),
      stored_preview: secretPreview(secrets.huggingfaceApiKey),
      discovered: Boolean(scan.secrets.huggingfaceApiKey),
      discovered_source: scan.sourceMap.huggingfaceApiKey || null,
      cli: cliStatus.huggingface
    },
    {
      id: 'elevenlabs',
      display_name: 'ElevenLabs',
      auth_kind: 'api_key',
      configured: Boolean(secrets.elevenlabsApiKey),
      stored: Boolean(secrets.elevenlabsApiKey),
      stored_preview: secretPreview(secrets.elevenlabsApiKey),
      discovered: Boolean(scan.secrets.elevenlabsApiKey),
      discovered_source: scan.sourceMap.elevenlabsApiKey || null,
      cli: cliStatus.elevenlabs
    },
    {
      id: 'telegram',
      display_name: 'Telegram',
      auth_kind: 'bot_token',
      configured: Boolean(secrets.telegramBotToken),
      stored: Boolean(secrets.telegramBotToken),
      stored_preview: secretPreview(secrets.telegramBotToken),
      discovered: Boolean(scan.secrets.telegramBotToken),
      discovered_source: scan.sourceMap.telegramBotToken || null,
      cli: null
    },
    {
      id: 'openai-oauth',
      display_name: 'OpenAI Codex OAuth',
      auth_kind: 'oauth_native',
      configured: Boolean(effectiveOpenAiOauth.active),
      stored: Boolean(storedOpenAiOauth?.access),
      stored_preview: secretPreview(storedOpenAiOauth?.access || secrets.openaiOauthToken),
      discovered: Boolean(scan.secrets.openaiOauthToken),
      discovered_source: scan.sourceMap.openaiOauthToken || null,
      cli: cliStatus.openclaw
    },
    {
      id: 'github-copilot',
      display_name: 'GitHub Copilot',
      auth_kind: 'token',
      configured: Boolean(secrets.copilotGithubToken),
      stored: Boolean(secrets.copilotGithubToken),
      stored_preview: secretPreview(secrets.copilotGithubToken),
      discovered: Boolean(scan.secrets.copilotGithubToken),
      discovered_source: scan.sourceMap.copilotGithubToken || null,
      cli: null
    }
  ];
}

const PROVIDER_SECRET_FIELD = {
  ollama: null,
  nvidia: 'nvidiaApiKey',
  openrouter: 'openrouterApiKey',
  openai: 'openaiApiKey'
};

const PROVIDER_BASE_FIELD = {
  ollama: 'ollamaBaseUrl',
  nvidia: 'nvidiaBaseUrl',
  openrouter: 'openrouterBaseUrl',
  openai: 'openaiBaseUrl'
};

function providerConnectionOverrides(provider, body = {}) {
  const normalized = normalizeProviderId(provider);
  const baseField = PROVIDER_BASE_FIELD[normalized];
  const secretField = PROVIDER_SECRET_FIELD[normalized];
  return {
    provider: normalized,
    baseUrl: String(body.baseUrl || config.model?.[baseField] || '').trim(),
    apiKey: secretField ? String(body.apiKey || config.model?.[secretField] || '').trim() : ''
  };
}

function secretForService(service, providedSecret = '') {
  const secret = String(providedSecret || '').trim();
  if (secret) return secret;
  const store = loadSecretStore();
  const secrets = store.secrets || {};
  const scan = scanLocalAuthSources();
  if (service === 'github') return String(secrets.githubToken || '').trim();
  if (service === 'huggingface') return String(secrets.huggingfaceApiKey || '').trim();
  if (service === 'elevenlabs') return String(secrets.elevenlabsApiKey || '').trim();
  if (service === 'telegram') return String(secrets.telegramBotToken || '').trim();
  if (service === 'openai-oauth') return String(secrets.openaiOauthToken || scan.secrets.openaiOauthToken || '').trim();
  if (service === 'github-copilot') return String(secrets.copilotGithubToken || '').trim();
  return '';
}

async function testProviderConnection({ provider, baseUrl, apiKey }) {
  const normalized = normalizeProviderId(provider);
  let models = [];
  if (normalized === 'ollama') models = await fetchOllamaModels(baseUrl);
  else if (normalized === 'nvidia') models = await fetchNvidiaModels(baseUrl, apiKey);
  else if (normalized === 'openrouter') models = await fetchOpenRouterModels(baseUrl, apiKey);
  else models = await fetchOpenAIModels(baseUrl, apiKey);
  return {
    ok: true,
    provider: normalized,
    modelCount: models.length,
    topModel: models[0]?.model_id || null,
    status: 'healthy'
  };
}

async function testServiceConnection({ service, secret }) {
  const id = String(service || '').trim().toLowerCase();
  const cli = getCliAuthStatus();
  if (id === 'github') {
    if (secret) {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${secret}`,
          'User-Agent': 'openunum'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) throw new Error(`github_test_failed:${res.status}`);
      const data = await res.json();
      return { ok: true, service: id, status: 'authenticated', account: data.login || null };
    }
    return {
      ok: Boolean(cli.github?.authenticated),
      service: id,
      status: cli.github?.authenticated ? 'authenticated' : (cli.github?.available ? 'available' : 'unavailable'),
      account: cli.github?.account || null,
      detail: cli.github?.detail || null
    };
  }
  if (id === 'google-workspace') {
    const googleClient = new (await import('./tools/google-workspace.mjs')).GoogleWorkspaceClient(config);
    const status = await googleClient.status();
    return {
      ok: Boolean(status.authenticated),
      service: id,
      status: status.authenticated ? 'authenticated' : (status.installed ? 'available' : 'unavailable'),
      account: status.account || null,
      detail: status.detail || null,
      prerequisite: status.installed ? null : status.hint || 'Save a Google OAuth Desktop Client ID first.'
    };
  }
  if (id === 'huggingface') {
    if (secret) {
      const res = await fetch('https://huggingface.co/api/whoami-v2', {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) throw new Error(`huggingface_test_failed:${res.status}`);
      const data = await res.json();
      return { ok: true, service: id, status: 'authenticated', account: data.name || data.fullname || null };
    }
    return {
      ok: Boolean(cli.huggingface?.authenticated),
      service: id,
      status: cli.huggingface?.authenticated ? 'authenticated' : (cli.huggingface?.available ? 'available' : 'unavailable'),
      account: cli.huggingface?.account || null,
      detail: cli.huggingface?.detail || null
    };
  }
  if (id === 'elevenlabs') {
    if (!secret) {
      return {
        ok: false,
        service: id,
        status: cli.elevenlabs?.available ? 'available' : 'unavailable',
        detail: cli.elevenlabs?.detail || 'secret_required'
      };
    }
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': secret },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`elevenlabs_test_failed:${res.status}`);
    const data = await res.json();
    return { ok: true, service: id, status: 'authenticated', account: data.subscription?.tier || data.email || null };
  }
  if (id === 'telegram') {
    if (!secret) throw new Error('telegram_token_missing');
    const res = await fetch(`https://api.telegram.org/bot${secret}/getMe`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`telegram_test_failed:${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(`telegram_test_failed:${data.description || 'unknown'}`);
    return { ok: true, service: id, status: 'authenticated', account: data.result?.username || data.result?.first_name || null };
  }
  if (id === 'openai-oauth') {
    if (!secret) throw new Error('openai_oauth_token_missing');
    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`openai_oauth_test_failed:${res.status}`);
    const data = await res.json();
    return {
      ok: true,
      service: id,
      status: 'authenticated',
      account: data.plan_type || null,
      detail: data.rate_limit?.primary_window ? 'usage endpoint reachable' : 'oauth token accepted'
    };
  }
  if (id === 'github-copilot') {
    if (!secret) throw new Error('copilot_token_missing');
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${secret}`,
        'User-Agent': 'openunum'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`github_copilot_test_failed:${res.status}`);
    const data = await res.json();
    return { ok: true, service: id, status: 'authenticated', account: data.login || null };
  }
  throw new Error(`unsupported_service:${id}`);
}

function oauthCommandForService(service) {
  const id = String(service || '').trim().toLowerCase();
  if (id === 'github') return 'gh auth login -w';
  if (id === 'openai-oauth') return 'openclaw models auth login --provider openai-codex';
  return null;
}

function launchInTerminal(cmd) {
  const wrapped = `${cmd}; printf '\\n'; read -r -p 'Press Enter to close...' _`;
  const candidates = [
    ['x-terminal-emulator', ['-e', 'bash', '-lc', wrapped]],
    ['gnome-terminal', ['--', 'bash', '-lc', wrapped]]
  ];
  for (const [bin, args] of candidates) {
    try {
      execSync(`command -v ${bin}`, { stdio: 'ignore' });
    } catch {
      continue;
    }
    try {
      const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, started: true, command: cmd, launcher: bin, pid: child.pid };
    } catch {
      continue;
    }
  }
  return { ok: false, started: false, error: 'terminal_not_available', command: cmd };
}

function launchOauthCommand(service) {
  const cmd = oauthCommandForService(service);
  if (!cmd) return { ok: false, started: false, error: 'oauth_not_supported' };
  const cli = getCliAuthStatus();
  if (service === 'github' && !cli.github?.available) return { ok: false, started: false, error: 'gh_not_available' };
  if (service === 'openai-oauth' && !cli.openclaw?.available) {
    return {
      ok: false,
      started: false,
      error: 'openclaw_not_available',
      prerequisite: 'Install or expose the `openclaw` CLI to launch the OpenAI Codex OAuth flow.'
    };
  }
  return launchInTerminal(cmd);
}

async function buildAuthCatalogPayload() {
  reloadConfigSecrets();
  const [catalog] = await Promise.all([buildModelCatalog(config.model)]);
  const store = loadSecretStore();
  const scan = scanLocalAuthSources();
  const cliStatus = getCliAuthStatus();
  const effectiveOpenAiOauth = getEffectiveOpenAICodexOAuthStatus();
  const providerKeyField = {
    ollama: null,
    nvidia: 'nvidiaApiKey',
    openrouter: 'openrouterApiKey',
    openai: 'openaiApiKey'
  };
  const providerBaseField = {
    ollama: 'ollamaBaseUrl',
    nvidia: 'nvidiaBaseUrl',
    openrouter: 'openrouterBaseUrl',
    openai: 'openaiBaseUrl'
  };

  return {
    contract_version: AUTH_CATALOG_CONTRACT_VERSION,
    secret_store_path: getSecretsPath(),
    provider_order: [...PROVIDER_ORDER],
    auth_targets: AUTH_TARGET_DEFS,
    scanned_files: scan.filesScanned,
    providers: catalog.providers.map((provider) => {
      const keyField = providerKeyField[provider.provider];
      const baseField = providerBaseField[provider.provider];
      const storedValue = keyField ? store.secrets?.[keyField] : '';
      const discoveredValue = keyField ? scan.secrets?.[keyField] : '';
      return {
        provider: provider.provider,
        display_name: provider.display_name,
        auth_kind: provider.provider === 'ollama' ? 'none' : 'api_key',
        selected: catalog.selected?.provider === provider.provider,
        status: provider.status,
        degraded_reason: provider.degraded_reason,
        base_url: config.model?.[baseField] || null,
        base_url_source: scan.sourceMap?.[baseField] || null,
        model_count: provider.models?.length || 0,
        top_model: provider.models?.[0]?.model_id || null,
        top_model_rank: provider.models?.[0]?.rank || null,
        stored: Boolean(storedValue),
        stored_preview: secretPreview(storedValue),
        discovered: Boolean(discoveredValue),
        discovered_source: keyField ? (scan.sourceMap?.[keyField] || null) : null,
        auth_ready: provider.provider === 'ollama'
          ? true
          : provider.provider === 'openai'
            ? Boolean(config.model?.[keyField] || effectiveOpenAiOauth.active)
            : Boolean(config.model?.[keyField]),
        auth_mode: provider.provider === 'openai' && effectiveOpenAiOauth.active && !config.model?.[keyField]
          ? 'oauth'
          : (provider.provider === 'ollama' ? 'none' : 'api_key')
      };
    }),
    auth_methods: buildAuthMethodRows(store, scan, cliStatus)
  };
}

function buildCapabilitiesPayload() {
  const dynamicProviders = [...new Set([
    ...PROVIDER_ORDER,
    ...Object.keys(config.model?.providerModels || {})
      .map((provider) => normalizeProviderId(provider))
      .filter(Boolean)
  ])];
  const services = AUTH_TARGET_DEFS
    .map((item) => String(item?.id || '').trim().toLowerCase())
    .filter(Boolean);
  const executionEnvelope = resolveExecutionEnvelope({
    provider: config.model?.provider,
    model: config.model?.model,
    runtime: config.runtime
  });
  return {
    contract_version: '2026-04-02.webui-capabilities.v2',
    menu: ['chat', 'missions', 'trace', 'runtime', 'settings'],
    features: {
      chat: true,
      sessions: true,
      missions: true,
      trace: true,
      model_catalog: true,
      provider_health: true,
      self_heal: true,
      browser_control: true,
      git_runtime: true,
      memory_inspection: true
    },
    provider_order: dynamicProviders,
    services,
    model_catalog_contract_version: MODEL_CATALOG_CONTRACT_VERSION,
    model_execution: {
      active: executionEnvelope,
      enforce_profiles: config.runtime?.enforceModelExecutionProfiles !== false,
      profiles: config.runtime?.modelExecutionProfiles || {}
    },
    tool_catalog: {
      contract_version: TOOL_CATALOG_CONTRACT_VERSION,
      tools: agent.toolRuntime.toolCatalog({ allowedTools: executionEnvelope.toolAllowlist })
    },
    operation_guards: {
      idempotency_operation_id: true,
      destructive_force_flag: true
    },
    autonomy_policy: {
      enabled: config.runtime?.autonomyPolicy?.enabled !== false,
      mode: String(config.runtime?.autonomyPolicy?.mode || 'execute'),
      enforce_self_protection: config.runtime?.autonomyPolicy?.enforceSelfProtection !== false
    }
  };
}

function readGitOverview(workspaceRoot) {
  const cwd = String(workspaceRoot || process.cwd());
  try {
    const statusText = execSync(`git -C "${cwd}" status --branch --porcelain=v1`, { encoding: 'utf8' }).trim();
    const lines = statusText ? statusText.split('\n') : [];
    const branchLine = lines[0] || '';
    const branchMatch = branchLine.match(/^##\s+([^.\s]+)(?:\.\.\.[^\s]+)?(?:\s+\[ahead (\d+)\])?(?:,\s+behind (\d+))?/);
    const branch = branchMatch?.[1] || 'unknown';
    const ahead = Number(branchMatch?.[2] || 0);
    const behind = Number(branchMatch?.[3] || 0);
    const modified = lines.slice(1).filter((line) => /^[ MARCUD?!]/.test(line)).length;
    const recentCommits = execSync(`git -C "${cwd}" log --oneline -5`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const firstSpace = line.indexOf(' ');
        return {
          hash: firstSpace === -1 ? line : line.slice(0, firstSpace),
          message: firstSpace === -1 ? '' : line.slice(firstSpace + 1)
        };
      });
    return { ok: true, branch, ahead, behind, modified, recentCommits };
  } catch (error) {
    return { ok: false, error: String(error.message || error), branch: null, ahead: 0, behind: 0, modified: 0, recentCommits: [] };
  }
}

async function buildRuntimeOverview() {
  normalizeModelSettings();
  const [browserStatus, catalog] = await Promise.all([
    browser.status().catch((error) => ({ ok: false, error: String(error.message || error) })),
    buildModelCatalog(config.model)
  ]);
  return {
    workspaceRoot: config.runtime?.workspaceRoot || process.cwd(),
    autonomyMode: config.runtime?.autonomyMode || 'autonomy-first',
    executionEnvelope: resolveExecutionEnvelope({
      provider: config.model?.provider,
      model: config.model?.model,
      runtime: config.runtime
    }),
    autonomyPolicy: {
      enabled: config.runtime?.autonomyPolicy?.enabled !== false,
      mode: String(config.runtime?.autonomyPolicy?.mode || 'execute'),
      enforceSelfProtection: config.runtime?.autonomyPolicy?.enforceSelfProtection !== false
    },
    browser: browserStatus,
    git: readGitOverview(config.runtime?.workspaceRoot || process.cwd()),
    selectedModel: catalog.selected,
    fallbackModel: catalog.fallback,
    providers: catalog.providers.map((provider) => ({
      provider: provider.provider,
      displayName: provider.display_name,
      status: provider.status,
      degradedReason: provider.degraded_reason,
      topModel: provider.models?.[0]?.model_id || null,
      modelCount: provider.models?.length || 0
    })),
    providerAvailability: agent.getProviderAvailabilitySnapshot
      ? agent.getProviderAvailabilitySnapshot()
      : []
  };
}

function buildRuntimeInventory(limit = 300) {
  const facts = memory.listFacts ? memory.listFacts({ limit }) : [];
  const latest = new Map();
  for (const row of facts) {
    const key = String(row?.key || '').trim();
    if (!key || latest.has(key)) continue;
    latest.set(key, {
      value: String(row?.value || ''),
      createdAt: row?.createdAt || null
    });
  }
  const sections = {
    owner: {},
    runtime: {},
    system: {},
    hardware: {},
    models: {},
    repo: {},
    workspace: {},
    browser: {},
    http: {}
  };
  for (const [key, row] of latest.entries()) {
    const [prefix, ...rest] = key.split('.');
    const section = sections[prefix];
    if (!section || rest.length === 0) continue;
    section[rest.join('.')] = {
      value: row.value,
      createdAt: row.createdAt
    };
  }
  return {
    factsCount: facts.length,
    updatedAt: new Date().toISOString(),
    owner: sections.owner,
    runtime: sections.runtime,
    system: sections.system,
    hardware: sections.hardware,
    models: sections.models,
    repo: sections.repo,
    workspace: sections.workspace,
    browser: sections.browser,
    http: sections.http,
    latestFacts: Object.fromEntries(latest.entries())
  };
}

function buildAutonomyInsights({ sessionId = '', goal = '' } = {}) {
  const sid = String(sessionId || '').trim();
  const query = String(goal || '').trim();
  return {
    sessionId: sid || null,
    goal: query || null,
    context: sid ? agent.getContextStatus(sid) : null,
    recentStrategies: memory.getStrategyLedger ? memory.getStrategyLedger({ goal: query, limit: 10 }) : [],
    toolReliability: memory.getToolReliability ? memory.getToolReliability(10) : [],
    recentToolRuns: sid ? memory.getRecentToolRuns(sid, 10) : [],
    recentCompactions: sid ? memory.listSessionCompactions(sid, 5) : []
  };
}

function buildMissionTimeline(mission) {
  if (!mission) return null;
  const sessionId = mission.sessionId;
  return {
    mission: {
      id: mission.id,
      goal: mission.goal,
      status: mission.status,
      step: mission.step,
      maxSteps: mission.maxSteps,
      hardStepCap: mission.hardStepCap,
      retries: mission.retries,
      contract: mission.contract || null,
      contractFailures: Number(mission.contractFailures || 0),
      rollbackAttempts: Number(mission.rollbackAttempts || 0),
      startedAt: mission.startedAt,
      finishedAt: mission.finishedAt,
      sessionId
    },
    log: Array.isArray(mission.log) ? mission.log : [],
    toolRuns: sessionId ? memory.getRecentToolRuns(sessionId, 20) : [],
    compactions: sessionId ? memory.listSessionCompactions(sessionId, 10) : [],
    artifacts: sessionId ? memory.getMemoryArtifacts(sessionId, 10) : [],
    recentStrategies: memory.getStrategyLedger ? memory.getStrategyLedger({ goal: mission.goal, limit: 10 }) : []
  };
}

function applyAutonomyMode(mode) {
  const m = String(mode || 'autonomy-first').toLowerCase();
  if (m === 'compact-local') {
    config.runtime.autonomyMode = 'compact-local';
    config.runtime.shellEnabled = true;
    config.runtime.maxToolIterations = 4;
    config.runtime.executorRetryAttempts = 2;
    config.runtime.executorRetryBackoffMs = 500;
    config.runtime.missionDefaultContinueUntilDone = true;
    config.runtime.missionDefaultHardStepCap = 48;
    config.runtime.missionDefaultMaxRetries = 2;
    config.runtime.missionDefaultIntervalMs = 600;
    config.runtime.contextProtectRecentTurns = Math.min(Number(config.runtime.contextProtectRecentTurns || 8), 4);
    config.runtime.autonomyPolicy = {
      ...(config.runtime.autonomyPolicy || {}),
      enabled: true,
      mode: 'execute',
      enforceSelfProtection: true
    };
    config.model.routing.forcePrimaryProvider = true;
    config.model.routing.fallbackEnabled = false;
    config.model.routing.fallbackProviders = [config.model.provider];
    autonomyMaster.stop();
    return 'compact-local';
  }
  if (m === 'relentless') {
    config.runtime.autonomyMode = 'relentless';
    config.runtime.shellEnabled = true;
    config.runtime.maxToolIterations = 20;
    config.runtime.executorRetryAttempts = 6;
    config.runtime.executorRetryBackoffMs = 900;
    config.runtime.missionDefaultContinueUntilDone = true;
    config.runtime.missionDefaultHardStepCap = 300;
    config.runtime.missionDefaultMaxRetries = 8;
    config.runtime.missionDefaultIntervalMs = 250;
    config.runtime.autonomyPolicy = {
      ...(config.runtime.autonomyPolicy || {}),
      enabled: true,
      mode: 'execute',
      enforceSelfProtection: true
    };
    config.model.routing.forcePrimaryProvider = true;
    config.model.routing.fallbackEnabled = false;
    config.model.routing.fallbackProviders = [config.model.provider];
    if (config.runtime.autonomyMasterAutoStart) autonomyMaster.start();
    return 'relentless';
  }

  config.runtime.autonomyMode = 'autonomy-first';
  config.runtime.maxToolIterations = 8;
  config.runtime.executorRetryAttempts = 3;
  config.runtime.executorRetryBackoffMs = 700;
  config.runtime.missionDefaultContinueUntilDone = true;
  config.runtime.missionDefaultHardStepCap = 120;
  config.runtime.missionDefaultMaxRetries = 3;
  config.runtime.missionDefaultIntervalMs = 400;
  config.runtime.autonomyPolicy = {
    ...(config.runtime.autonomyPolicy || {}),
    enabled: true,
    mode: 'execute',
    enforceSelfProtection: true
  };
  if (!config.model.routing.fallbackProviders?.length) {
    config.model.routing.fallbackProviders = [...PROVIDER_ORDER];
  }
  autonomyMaster.stop();
  return 'autonomy-first';
}

function renderReplyHtml(text) {
  const raw = marked.parse(text || '');
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'pre', 'code']),
    allowedAttributes: {
      a: ['href', 'name', 'target'],
      img: ['src', 'alt']
    },
    allowedSchemes: ['http', 'https', 'mailto']
  });
}

function sendApiError(res, status, code, message, details = {}) {
  return sendApiErrorBase(
    res,
    status,
    code,
    message,
    details,
    API_ERROR_CONTRACT_VERSION
  );
}

async function runHealthCheck() {
  // Use the SelfHealMonitor for comprehensive health checks
  const result = await selfHealMonitor.runFullHealthCheck();
  return result;
}

async function runSelfHeal(dryRun = false) {
  const actions = [];
  const results = [];

  // Action 1: Check and fix config
  try {
    const cfg = loadConfig();
    if (!cfg.runtime) {
      actions.push({ action: 'fix_config_runtime', status: dryRun ? 'pending' : 'applied' });
      if (!dryRun) {
        cfg.runtime = defaultConfig().runtime;
        saveConfig(cfg);
      }
      results.push({ action: 'fix_config_runtime', success: true });
    } else {
      results.push({ action: 'config_ok', success: true });
    }
  } catch (error) {
    actions.push({ action: 'rebuild_config', status: dryRun ? 'pending' : 'applied' });
    if (!dryRun) {
      const newCfg = defaultConfig();
      saveConfig(newCfg);
    }
    results.push({ action: 'rebuild_config', success: true });
  }

  // Action 2: Check browser CDP
  try {
    const status = await browser.status();
    if (!status.ok) {
      actions.push({ action: 'browser_cdp_unhealthy', status: 'needs_attention', details: status });
      results.push({ action: 'browser_cdp_unhealthy', success: false, hint: 'Try /api/browser/launch' });
    } else {
      results.push({ action: 'browser_ok', success: true });
    }
  } catch (error) {
    actions.push({ action: 'browser_cdp_error', status: 'error', error: String(error.message || error) });
    results.push({ action: 'browser_cdp_error', success: false, hint: 'Check CDP URL in config' });
  }

  // Action 3: Check disk space
  try {
    const home = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
    const dfOut = execSync(`df -h "${home}" 2>/dev/null || df -h /`, { encoding: 'utf8' });
    const lines = dfOut.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const usePercent = parseInt(parts[4] || '0', 10);
      if (usePercent >= 90) {
        actions.push({ action: 'disk_space_critical', usedPercent: usePercent, status: 'warning' });
        results.push({ action: 'disk_space_critical', success: false, hint: 'Free up disk space' });
      } else {
        results.push({ action: 'disk_space_ok', usedPercent: usePercent, success: true });
      }
    }
  } catch {
    results.push({ action: 'disk_check_skipped', success: true });
  }

  // Action 4: Check pending chats
  const pendingCount = pendingChats.size;
  if (pendingCount > 10) {
    actions.push({ action: 'pending_chats_high', count: pendingCount, status: 'warning' });
    results.push({ action: 'pending_chats_high', success: false, hint: 'Wait for chats to complete or restart server' });
  } else {
    results.push({ action: 'pending_chats_ok', count: pendingCount, success: true });
  }

  // Action 5: Reload agent tools if config changed
  if (actions.some(a => a.action.includes('config'))) {
    actions.push({ action: 'reload_agent_tools', status: dryRun ? 'pending' : 'applied' });
    if (!dryRun) {
      agent.reloadTools();
    }
    results.push({ action: 'reload_agent_tools', success: !dryRun });
  }

  return { ok: results.every(r => r.success !== false), actions, results, dryRun };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, noCacheHeaders('text/plain'));
      res.end();
      return;
    }

    if (await handleHealthRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        pendingChats,
        parseBody,
        sendJson,
        runHealthCheck,
        runSelfHeal,
        logInfo,
        telegramLoopRunning
      }
    })) return;

    if (req.method === 'GET' && url.pathname === '/api/capabilities') {
      return sendJson(res, 200, buildCapabilitiesPayload());
    }

    if (req.method === 'GET' && url.pathname === '/api/tools/catalog') {
      const executionEnvelope = resolveExecutionEnvelope({
        provider: config.model?.provider,
        model: config.model?.model,
        runtime: config.runtime
      });
      return sendJson(res, 200, {
        contract_version: TOOL_CATALOG_CONTRACT_VERSION,
        enforce_profiles: config.runtime?.enforceModelExecutionProfiles !== false,
        allowed_tools: executionEnvelope.toolAllowlist || null,
        tools: agent.toolRuntime.toolCatalog({ allowedTools: executionEnvelope.toolAllowlist })
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/runtime/overview') {
      return sendJson(res, 200, await buildRuntimeOverview());
    }

    if (req.method === 'GET' && url.pathname === '/api/runtime/inventory') {
      const limit = Number(url.searchParams.get('limit') || 300);
      return sendJson(res, 200, buildRuntimeInventory(limit));
    }

    if (req.method === 'GET' && url.pathname === '/api/autonomy/insights') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const goal = String(url.searchParams.get('goal') || '').trim();
      return sendJson(res, 200, buildAutonomyInsights({ sessionId, goal }));
    }

    if (req.method === 'GET' && url.pathname === '/api/controller/behaviors') {
      const limitRaw = Number(url.searchParams.get('limit') || 80);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 400)) : 80;
      return sendJson(res, 200, {
        ok: true,
        behaviors: agent.getControllerBehaviorSnapshot(limit)
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/controller/behavior-classes') {
      return sendJson(res, 200, {
        ok: true,
        classes: agent.getBehaviorClasses()
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/controller/behavior/reset') {
      const body = await parseBody(req);
      const providerRaw = String(body?.provider || '').trim();
      const provider = normalizeProviderId(providerRaw);
      const model = String(body?.model || '').trim().toLowerCase();
      if (!providerRaw || !model) return sendJson(res, 400, { error: 'provider and model are required' });
      const out = agent.resetControllerBehavior({ provider, model });
      return sendJson(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && url.pathname === '/api/controller/behavior/reset-all') {
      const out = agent.resetAllControllerBehaviors();
      return sendJson(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && url.pathname === '/api/controller/behavior/override') {
      const body = await parseBody(req);
      const providerRaw = String(body?.provider || '').trim();
      const provider = normalizeProviderId(providerRaw);
      const model = String(body?.model || '').trim().toLowerCase();
      const classId = String(body?.classId || '').trim();
      const tuning = body?.tuning && typeof body.tuning === 'object' ? body.tuning : {};
      const needs = body?.needs && typeof body.needs === 'object' ? body.needs : {};
      if (!providerRaw || !model || !classId) {
        return sendJson(res, 400, { error: 'provider, model, and classId are required' });
      }
      const key = behaviorOverrideKey(provider, model);
      config.model.behaviorOverrides = config.model.behaviorOverrides || {};
      config.model.behaviorOverrides[key] = { classId, tuning, needs };
      saveConfig(config);
      return sendJson(res, 200, {
        ok: true,
        key,
        override: config.model.behaviorOverrides[key]
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/controller/behavior/override/remove') {
      const body = await parseBody(req);
      const providerRaw = String(body?.provider || '').trim();
      const provider = normalizeProviderId(providerRaw);
      const model = String(body?.model || '').trim().toLowerCase();
      if (!providerRaw || !model) return sendJson(res, 400, { error: 'provider and model are required' });
      const key = behaviorOverrideKey(provider, model);
      config.model.behaviorOverrides = config.model.behaviorOverrides || {};
      const removed = Boolean(config.model.behaviorOverrides[key]);
      delete config.model.behaviorOverrides[key];
      saveConfig(config);
      return sendJson(res, 200, { ok: true, removed, key });
    }

    if (await handleModelRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        parseBody,
        sendJson,
        saveConfig,
        buildModelCatalog,
        buildLegacyProviderModels,
        normalizeModelSettings,
        normalizeProviderId,
        PROVIDER_ORDER
      }
    })) return;

    if (await handleAuthRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        parseBody,
        sendJson,
        noCacheHeaders,
        sanitizeHtml,
        buildAuthCatalogPayload,
        persistSecretUpdates,
        saveConfig,
        scanLocalAuthSources,
        providerConnectionOverrides,
        testProviderConnection,
        testServiceConnection,
        secretForService,
        getAuthJob,
        summarizeAuthJob,
        findGoogleWorkspaceAuthJobByState,
        completeGoogleWorkspaceAuthJob,
        completeAuthJob,
        startOpenAICodexOAuthJob,
        startGoogleWorkspaceOAuthJob,
        launchOauthCommand,
        saveGoogleWorkspaceOAuthConfig,
        normalizeGoogleWorkspaceOAuthConfig
      }
    })) return;

    if (await handleConfigRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        parseBody,
        sendJson,
        saveConfig,
        normalizeModelSettings,
        normalizeProviderId,
        reloadConfigSecrets,
        buildModelCatalog,
        scrubSecretsFromConfig,
        buildCapabilitiesPayload,
        getProviderConfigPayload,
        buildAuthCatalogPayload,
        startResearchDailyLoop,
        stopResearchDailyLoop,
        persistSecretUpdates,
        importProviderSecretsFromOpenClaw
      }
    })) return;

    if (await handleAutonomyRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        memory,
        missions,
        parseBody,
        sendJson,
        saveConfig,
        applyAutonomyMode,
        autonomyMaster
      }
    })) return;

    if (await handleChatToolsRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        memory,
        missions,
        parseBody,
        sendJson,
        pendingChats,
        getOrStartChat,
        withTimeout,
        renderReplyHtml
      }
    })) return;

    if (await handleSkillsResearchRoute({
      req,
      res,
      url,
      ctx: {
        agent,
        parseBody,
        sendJson
      }
    })) return;

    if (await handleSessionsRoute({
      req,
      res,
      url,
      ctx: {
        memory,
        pendingChats,
        parseBody,
        sendJson,
        sendApiError,
        prunePendingChats,
        estimateMessagesTokens,
        renderReplyHtml
      }
    })) return;

    if (await handleMissionsRoute({
      req,
      res,
      url,
      ctx: {
        config,
        missions,
        parseBody,
        sendJson,
        buildMissionTimeline
      }
    })) return;

    if (await handleBrowserRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        parseBody,
        sendJson,
        saveConfig,
        CDPBrowser,
        launchDebugBrowser,
        getBrowser: () => browser,
        setBrowser: (nextBrowser) => { browser = nextBrowser; }
      }
    })) return;

    if (await handleTelegramRoute({
      req,
      res,
      url,
      ctx: {
        config,
        parseBody,
        sendJson,
        saveConfig,
        reloadConfigSecrets,
        persistSecretUpdates,
        runTelegramLoop,
        stopTelegramLoop,
        telegramLoopRunning,
        telegramLoopStopRequested
      }
    })) return;

    if (await handleUiRoute({
      req,
      res,
      url,
      ctx: { noCacheHeaders }
    })) return;

    return sendApiError(res, 404, 'not_found', 'Unknown API route');
  } catch (error) {
    logError('request_failed', { error: String(error.message || error) });
    if (String(error?.code || '') === 'invalid_json') {
      return sendApiError(res, 400, 'invalid_json', 'Request body must be valid JSON');
    }
    return sendApiError(res, 500, 'internal_error', String(error.message || error));
  }
});

server.listen(config.server.port, config.server.host, () => {
  logInfo('openunum_server_started', { host: config.server.host, port: config.server.port });
  if (config.runtime?.autonomyMasterAutoStart) {
    autonomyMaster.start();
  }
  if (config.runtime?.researchDailyEnabled) {
    startResearchDailyLoop();
  }
});
