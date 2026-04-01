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
import { CDPBrowser } from './browser/cdp.mjs';
import { TelegramChannel } from './channels/telegram.mjs';
import { logInfo, logError } from './logger.mjs';
import {
  AUTH_CATALOG_CONTRACT_VERSION,
  AUTH_TARGET_DEFS,
  applySecretsToConfig,
  getCliAuthStatus,
  getSecretsPath,
  loadSecretStore,
  mergeSecrets,
  saveSecretStore,
  scanLocalAuthSources,
  scrubSecretsFromConfig,
  secretPreview
} from './secrets/store.mjs';
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

const config = loadConfig();
normalizeModelSettings();
const memory = new MemoryStore();
const agent = new OpenUnumAgent({ config, memoryStore: memory });
const missions = new MissionRunner({ agent, memoryStore: memory, config });
let browser = new CDPBrowser(config.browser?.cdpUrl);
const autonomyMaster = getAutonomyMaster({ config, agent, memoryStore: memory, browser });
const selfHealMonitor = new SelfHealMonitor({ config, agent, browser, memory });
let telegramLoopRunning = false;
let telegramLoopStopRequested = false;
let telegramLoopPromise = null;
const pendingChats = new Map();
let researchDailyTimer = null;

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
      auth_kind: 'oauth_cli',
      configured: Boolean(cliStatus.googleWorkspace?.authenticated),
      stored: false,
      stored_preview: null,
      discovered: false,
      discovered_source: null,
      cli: cliStatus.googleWorkspace
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
      display_name: 'OpenAI OAuth',
      auth_kind: 'oauth_token',
      configured: Boolean(secrets.openaiOauthToken),
      stored: Boolean(secrets.openaiOauthToken),
      stored_preview: secretPreview(secrets.openaiOauthToken),
      discovered: Boolean(scan.secrets.openaiOauthToken),
      discovered_source: scan.sourceMap.openaiOauthToken || null,
      cli: null
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
  if (service === 'github') return String(secrets.githubToken || '').trim();
  if (service === 'huggingface') return String(secrets.huggingfaceApiKey || '').trim();
  if (service === 'elevenlabs') return String(secrets.elevenlabsApiKey || '').trim();
  if (service === 'telegram') return String(secrets.telegramBotToken || '').trim();
  if (service === 'openai-oauth') return String(secrets.openaiOauthToken || '').trim();
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
    return {
      ok: Boolean(cli.googleWorkspace?.authenticated),
      service: id,
      status: cli.googleWorkspace?.authenticated ? 'authenticated' : (cli.googleWorkspace?.available ? 'available' : 'unavailable'),
      account: cli.googleWorkspace?.account || null,
      detail: cli.googleWorkspace?.detail || null
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
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`openai_oauth_test_failed:${res.status}`);
    const data = await res.json();
    return { ok: true, service: id, status: 'authenticated', modelCount: Array.isArray(data.data) ? data.data.length : 0 };
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
  if (id === 'google-workspace') return 'gcloud auth login --update-adc';
  return null;
}

function launchOauthCommand(service) {
  const cmd = oauthCommandForService(service);
  if (!cmd) return { ok: false, started: false, error: 'oauth_not_supported' };
  const cli = getCliAuthStatus();
  if (service === 'github' && !cli.github?.available) return { ok: false, started: false, error: 'gh_not_available' };
  if (service === 'google-workspace' && !cli.googleWorkspace?.available) return { ok: false, started: false, error: 'gcloud_not_available' };
  const child = spawn('bash', ['-lc', cmd], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return { ok: true, started: true, command: cmd, pid: child.pid };
}

async function buildAuthCatalogPayload() {
  reloadConfigSecrets();
  const [catalog] = await Promise.all([buildModelCatalog(config.model)]);
  const store = loadSecretStore();
  const scan = scanLocalAuthSources();
  const cliStatus = getCliAuthStatus();
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
        auth_ready: provider.provider === 'ollama' ? true : Boolean(config.model?.[keyField])
      };
    }),
    auth_methods: buildAuthMethodRows(store, scan, cliStatus)
  };
}

function buildCapabilitiesPayload() {
  return {
    contract_version: '2026-04-01.webui-capabilities.v1',
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
    provider_order: [...PROVIDER_ORDER],
    model_catalog_contract_version: MODEL_CATALOG_CONTRACT_VERSION
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
    }))
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

async function runTelegramLoop() {
  if (!config.channels.telegram?.botToken) {
    throw new Error('Missing Telegram bot token');
  }
  if (telegramLoopRunning) return;
  telegramLoopStopRequested = false;
  telegramLoopRunning = true;
  const tg = new TelegramChannel(config.channels.telegram, async (text, sessionId) => {
    const out = await agent.chat({ message: text, sessionId });
    return out.reply;
  });
  telegramLoopPromise = (async () => {
    while (!telegramLoopStopRequested) {
      try {
        await tg.pollOnce();
      } catch (error) {
        logError('telegram_poll_error', { error: String(error.message || error) });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    telegramLoopRunning = false;
  })();
}

async function stopTelegramLoop() {
  telegramLoopStopRequested = true;
  if (telegramLoopPromise) {
    await Promise.race([telegramLoopPromise, new Promise((r) => setTimeout(r, 3000))]);
  }
  telegramLoopRunning = false;
}

function resolveChromeBin() {
  const candidates = ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function launchDebugBrowser() {
  const chromeBin = resolveChromeBin();
  if (!chromeBin) {
    throw new Error('No Chromium/Chrome executable found on host');
  }
  const port = 9333;
  // Kill stale debug instances so a new visible window can be created reliably.
  try {
    spawn('pkill', ['-f', 'openunum-chrome-debug'], { stdio: 'ignore' });
  } catch {
    // ignore best-effort cleanup errors
  }

  const args = [
    `--remote-debugging-port=${port}`,
    '--user-data-dir=/tmp/openunum-chrome-debug',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--new-window',
    'about:blank'
  ];
  const child = spawn(chromeBin, args, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  // Verify endpoint is actually up before reporting success.
  let ready = false;
  for (let i = 0; i < 20; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!ready) {
    return {
      ok: false,
      error: 'debug_browser_not_ready',
      hint: 'Chromium did not expose CDP on port 9333 after launch.'
    };
  }

  config.browser.cdpUrl = `http://127.0.0.1:${port}`;
  saveConfig(config);
  browser = new CDPBrowser(config.browser.cdpUrl);
  agent.reloadTools();
  return { ok: true, cdpUrl: config.browser.cdpUrl, pid: child.pid };
}

function msUntilNextHour(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(Number(hour));
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(60 * 1000, next.getTime() - now.getTime());
}

function stopResearchDailyLoop() {
  if (researchDailyTimer) {
    clearTimeout(researchDailyTimer);
    researchDailyTimer = null;
  }
}

function startResearchDailyLoop() {
  stopResearchDailyLoop();
  if (!config.runtime?.researchDailyEnabled) return;
  const run = async () => {
    try {
      await agent.runTool('research_run_daily', { simulate: false });
      logInfo('research_daily_completed', {});
    } catch (error) {
      logError('research_daily_failed', { error: String(error.message || error) });
    } finally {
      researchDailyTimer = setTimeout(run, msUntilNextHour(config.runtime.researchScheduleHour ?? 3));
    }
  };
  researchDailyTimer = setTimeout(run, msUntilNextHour(config.runtime.researchScheduleHour ?? 3));
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function withTimeout(promise, timeoutMs, timeoutMessage = 'operation_timeout') {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
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

function getOrStartChat(sessionId, message) {
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('sessionId is required');
  const existing = pendingChats.get(sid);
  if (existing) return existing;
  const startedAt = new Date().toISOString();
  const promise = agent.chat({ message, sessionId: sid })
    .then((out) => {
      saveConfig(config);
      return out;
    })
    .finally(() => {
      pendingChats.delete(sid);
    });
  const entry = { sessionId: sid, message, startedAt, promise };
  pendingChats.set(sid, entry);
  return entry;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      const health = await runHealthCheck();
      return sendJson(res, 200, {
        ok: true,
        service: 'openunum',
        health
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/self-heal') {
      const dryRun = url.searchParams.get('dryRun') !== 'false';
      const result = await runSelfHeal(dryRun);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/self-heal') {
      const body = await parseBody(req);
      const dryRun = body.dryRun !== false;
      const result = await runSelfHeal(dryRun);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/self-heal/fix') {
      const result = await runSelfHeal(false);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/health/check') {
      const health = await runHealthCheck();
      return sendJson(res, health.ok ? 200 : 503, health);
    }

    if (req.method === 'POST' && url.pathname === '/api/selfheal/run') {
      const body = await parseBody(req);
      const dryRun = Boolean(body?.dryRun);
      const result = await runSelfHeal(dryRun);
      if (!dryRun && result.ok) {
        logInfo('selfheal_executed', { actions: result.actions.length, results: result.results.length });
      }
      return sendJson(res, result.ok ? 200 : 500, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/selfheal/status') {
      const status = {
        ok: true,
        uptime: process.uptime(),
        pendingChats: pendingChats.size,
        telegramRunning: telegramLoopRunning,
        config: {
          autonomyMode: config.runtime.autonomyMode,
          shellEnabled: config.runtime.shellEnabled,
          maxToolIterations: config.runtime.maxToolIterations
        },
        model: agent.getCurrentModel(),
        browser: { cdpUrl: config.browser?.cdpUrl },
        timestamp: new Date().toISOString()
      };
      return sendJson(res, 200, status);
    }

    if (req.method === 'GET' && url.pathname === '/api/capabilities') {
      return sendJson(res, 200, buildCapabilitiesPayload());
    }

    if (req.method === 'GET' && url.pathname === '/api/runtime/overview') {
      return sendJson(res, 200, await buildRuntimeOverview());
    }

    if (req.method === 'GET' && url.pathname === '/api/autonomy/insights') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const goal = String(url.searchParams.get('goal') || '').trim();
      return sendJson(res, 200, buildAutonomyInsights({ sessionId, goal }));
    }

    if (req.method === 'GET' && url.pathname === '/api/model-catalog') {
      normalizeModelSettings();
      const catalog = await buildModelCatalog(config.model);
      return sendJson(res, 200, catalog);
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/catalog') {
      return sendJson(res, 200, await buildAuthCatalogPayload());
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/catalog') {
      const body = await parseBody(req);
      const providerBaseUrls = body?.providerBaseUrls || {};
      const secretUpdates = body?.secrets || {};
      const clear = Array.isArray(body?.clear) ? body.clear : [];

      if (typeof providerBaseUrls.ollamaBaseUrl === 'string' && providerBaseUrls.ollamaBaseUrl.trim()) config.model.ollamaBaseUrl = providerBaseUrls.ollamaBaseUrl.trim();
      if (typeof providerBaseUrls.openrouterBaseUrl === 'string' && providerBaseUrls.openrouterBaseUrl.trim()) config.model.openrouterBaseUrl = providerBaseUrls.openrouterBaseUrl.trim();
      if (typeof providerBaseUrls.nvidiaBaseUrl === 'string' && providerBaseUrls.nvidiaBaseUrl.trim()) config.model.nvidiaBaseUrl = providerBaseUrls.nvidiaBaseUrl.trim();
      if (typeof providerBaseUrls.openaiBaseUrl === 'string' && providerBaseUrls.openaiBaseUrl.trim()) config.model.openaiBaseUrl = providerBaseUrls.openaiBaseUrl.trim();
      if (typeof body?.telegram?.enabled === 'boolean') {
        config.channels.telegram = config.channels.telegram || {};
        config.channels.telegram.enabled = body.telegram.enabled;
      }

      persistSecretUpdates(secretUpdates, clear);
      saveConfig(config);
      agent.reloadTools();

      return sendJson(res, 200, {
        ok: true,
        catalog: await buildAuthCatalogPayload()
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/prefill-local') {
      const body = await parseBody(req);
      const scan = scanLocalAuthSources();
      const overwriteBaseUrls = body?.overwriteBaseUrls === true;
      persistSecretUpdates(scan.secrets);
      if (scan.providerBaseUrls.ollamaBaseUrl && (overwriteBaseUrls || !config.model.ollamaBaseUrl)) config.model.ollamaBaseUrl = scan.providerBaseUrls.ollamaBaseUrl;
      if (scan.providerBaseUrls.openrouterBaseUrl && (overwriteBaseUrls || !config.model.openrouterBaseUrl)) config.model.openrouterBaseUrl = scan.providerBaseUrls.openrouterBaseUrl;
      if (scan.providerBaseUrls.nvidiaBaseUrl && (overwriteBaseUrls || !config.model.nvidiaBaseUrl)) config.model.nvidiaBaseUrl = scan.providerBaseUrls.nvidiaBaseUrl;
      if (scan.providerBaseUrls.openaiBaseUrl && (overwriteBaseUrls || !config.model.openaiBaseUrl)) config.model.openaiBaseUrl = scan.providerBaseUrls.openaiBaseUrl;
      saveConfig(config);
      agent.reloadTools();
      return sendJson(res, 200, {
        ok: true,
        imported: {
          openrouterApiKey: Boolean(scan.secrets.openrouterApiKey),
          nvidiaApiKey: Boolean(scan.secrets.nvidiaApiKey),
          openaiApiKey: Boolean(scan.secrets.openaiApiKey),
          githubToken: Boolean(scan.secrets.githubToken),
          huggingfaceApiKey: Boolean(scan.secrets.huggingfaceApiKey),
          elevenlabsApiKey: Boolean(scan.secrets.elevenlabsApiKey),
          telegramBotToken: Boolean(scan.secrets.telegramBotToken)
        },
        scannedFiles: scan.filesScanned,
        catalog: await buildAuthCatalogPayload()
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/provider/test') {
      const body = await parseBody(req);
      const connection = providerConnectionOverrides(body.provider, body);
      try {
        return sendJson(res, 200, await testProviderConnection(connection));
      } catch (error) {
        return sendJson(res, 200, {
          ok: false,
          provider: connection.provider,
          status: 'degraded',
          error: String(error.message || error)
        });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/service/test') {
      const body = await parseBody(req);
      try {
        return sendJson(res, 200, await testServiceConnection({
          service: body.service,
          secret: secretForService(String(body.service || '').trim().toLowerCase(), body.secret)
        }));
      } catch (error) {
        return sendJson(res, 200, {
          ok: false,
          service: String(body.service || '').trim().toLowerCase(),
          status: 'degraded',
          error: String(error.message || error)
        });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/service/connect') {
      const body = await parseBody(req);
      return sendJson(res, 200, launchOauthCommand(body.service));
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      reloadConfigSecrets();
      normalizeModelSettings();
      const catalog = await buildModelCatalog(config.model);
      const sanitized = scrubSecretsFromConfig(config);
      return sendJson(res, 200, {
        model: sanitized.model,
        runtime: sanitized.runtime,
        research: sanitized.research,
        integrations: sanitized.integrations,
        browser: sanitized.browser,
        channels: { telegram: { enabled: Boolean(config.channels?.telegram?.enabled), hasToken: Boolean(config.channels?.telegram?.botToken) } },
        capabilities: buildCapabilitiesPayload(),
        modelCatalog: catalog,
        providerConfig: getProviderConfigPayload(),
        authCatalog: await buildAuthCatalogPayload()
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/config') {
      const body = await parseBody(req);
      if (body.runtime && typeof body.runtime.shellEnabled === 'boolean') {
        config.runtime.shellEnabled = body.runtime.shellEnabled;
      }
      if (body.runtime && typeof body.runtime.workspaceRoot === 'string' && body.runtime.workspaceRoot.trim()) {
        config.runtime.workspaceRoot = body.runtime.workspaceRoot.trim();
      }
      if (body.runtime && typeof body.runtime.ownerControlMode === 'string' && body.runtime.ownerControlMode.trim()) {
        config.runtime.ownerControlMode = body.runtime.ownerControlMode.trim();
      }
      if (body.runtime && typeof body.runtime.selfPokeEnabled === 'boolean') {
        config.runtime.selfPokeEnabled = body.runtime.selfPokeEnabled;
      }
      if (body.runtime && Number.isFinite(body.runtime.toolCircuitFailureThreshold)) {
        config.runtime.toolCircuitFailureThreshold = Number(body.runtime.toolCircuitFailureThreshold);
      }
      if (body.runtime && Number.isFinite(body.runtime.toolCircuitCooldownMs)) {
        config.runtime.toolCircuitCooldownMs = Number(body.runtime.toolCircuitCooldownMs);
      }
      if (body.runtime && typeof body.runtime.autonomyMasterAutoStart === 'boolean') {
        config.runtime.autonomyMasterAutoStart = body.runtime.autonomyMasterAutoStart;
      }
      if (body.runtime && typeof body.runtime.researchDailyEnabled === 'boolean') {
        config.runtime.researchDailyEnabled = body.runtime.researchDailyEnabled;
      }
      if (body.runtime && Number.isFinite(body.runtime.researchScheduleHour)) {
        config.runtime.researchScheduleHour = Number(body.runtime.researchScheduleHour);
      }
      if (body.runtime && typeof body.runtime.contextCompactionEnabled === 'boolean') {
        config.runtime.contextCompactionEnabled = body.runtime.contextCompactionEnabled;
      }
      if (body.runtime && Number.isFinite(body.runtime.contextCompactTriggerPct)) {
        config.runtime.contextCompactTriggerPct = Number(body.runtime.contextCompactTriggerPct);
      }
      if (body.runtime && Number.isFinite(body.runtime.contextCompactTargetPct)) {
        config.runtime.contextCompactTargetPct = Number(body.runtime.contextCompactTargetPct);
      }
      if (body.runtime && Number.isFinite(body.runtime.contextHardFailPct)) {
        config.runtime.contextHardFailPct = Number(body.runtime.contextHardFailPct);
      }
      if (body.runtime && Number.isFinite(body.runtime.contextProtectRecentTurns)) {
        config.runtime.contextProtectRecentTurns = Number(body.runtime.contextProtectRecentTurns);
      }
      if (body.runtime && Number.isFinite(body.runtime.contextFallbackTokens)) {
        config.runtime.contextFallbackTokens = Number(body.runtime.contextFallbackTokens);
      }
      if (body.runtime && Number.isFinite(body.runtime.maxToolIterations)) {
        config.runtime.maxToolIterations = Number(body.runtime.maxToolIterations);
      }
      if (body.runtime && Number.isFinite(body.runtime.executorRetryAttempts)) {
        config.runtime.executorRetryAttempts = Number(body.runtime.executorRetryAttempts);
      }
      if (body.runtime && Number.isFinite(body.runtime.executorRetryBackoffMs)) {
        config.runtime.executorRetryBackoffMs = Number(body.runtime.executorRetryBackoffMs);
      }
      if (body.runtime && typeof body.runtime.autonomyMode === 'string') {
        config.runtime.autonomyMode = body.runtime.autonomyMode;
      }
      if (body.runtime && typeof body.runtime.missionDefaultContinueUntilDone === 'boolean') {
        config.runtime.missionDefaultContinueUntilDone = body.runtime.missionDefaultContinueUntilDone;
      }
      if (body.runtime && Number.isFinite(body.runtime.missionDefaultHardStepCap)) {
        config.runtime.missionDefaultHardStepCap = Number(body.runtime.missionDefaultHardStepCap);
      }
      if (body.runtime && Number.isFinite(body.runtime.missionDefaultMaxRetries)) {
        config.runtime.missionDefaultMaxRetries = Number(body.runtime.missionDefaultMaxRetries);
      }
      if (body.runtime && Number.isFinite(body.runtime.missionDefaultIntervalMs)) {
        config.runtime.missionDefaultIntervalMs = Number(body.runtime.missionDefaultIntervalMs);
      }
      if (body.model && typeof body.model.provider === 'string' && body.model.provider.trim()) {
        config.model.provider = normalizeProviderId(body.model.provider.trim());
      }
      if (body.model && typeof body.model.model === 'string' && body.model.model.trim()) {
        config.model.model = body.model.model.trim().replace(/^generic\//, 'openai/');
        config.model.providerModels = config.model.providerModels || {};
        config.model.providerModels[config.model.provider] = config.model.model;
      }
      if (body.model && body.model.providerModels && typeof body.model.providerModels === 'object') {
        config.model.providerModels = config.model.providerModels || {};
        for (const [provider, model] of Object.entries(body.model.providerModels)) {
          const normalizedProvider = normalizeProviderId(provider);
          if (typeof model === 'string' && model.trim()) {
            config.model.providerModels[normalizedProvider] = model.trim().replace(/^generic\//, 'openai/');
          }
        }
      }
      if (body.model && body.model.routing) {
        config.model.routing = { ...config.model.routing, ...body.model.routing };
        if (Array.isArray(body.model.routing.fallbackProviders)) {
          config.model.routing.fallbackProviders = body.model.routing.fallbackProviders.map((provider) => normalizeProviderId(provider));
        }
      }
      if (body.integrations?.googleWorkspace && typeof body.integrations.googleWorkspace.cliCommand === 'string') {
        config.integrations.googleWorkspace.cliCommand = body.integrations.googleWorkspace.cliCommand.trim() || 'gws';
      }
      normalizeModelSettings();
      saveConfig(config);
      agent.reloadTools();
      if (config.runtime.researchDailyEnabled) startResearchDailyLoop();
      else stopResearchDailyLoop();
      return sendJson(res, 200, { ok: true, runtime: config.runtime });
    }

    if (req.method === 'GET' && url.pathname === '/api/autonomy/mode') {
      return sendJson(res, 200, {
        mode: config.runtime.autonomyMode || 'standard',
        runtime: config.runtime,
        routing: config.model.routing
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/mode') {
      const body = await parseBody(req);
      const mode = applyAutonomyMode(body.mode);
      saveConfig(config);
      agent.reloadTools();
      return sendJson(res, 200, {
        ok: true,
        mode,
        runtime: config.runtime,
        routing: config.model.routing
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/autonomy/master/status') {
      return sendJson(res, 200, { ok: true, status: autonomyMaster.getStatus() });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/start') {
      const started = autonomyMaster.start();
      return sendJson(res, 200, { ok: true, started, status: autonomyMaster.getStatus() });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/stop') {
      const stopped = autonomyMaster.stop();
      return sendJson(res, 200, { ok: true, stopped, status: autonomyMaster.getStatus() });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/cycle') {
      const out = await autonomyMaster.runCycle();
      return sendJson(res, 200, { ok: true, result: out });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/self-improve') {
      const out = await autonomyMaster.selfImprove();
      return sendJson(res, 200, { ok: true, result: out });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/learn-skills') {
      const out = await autonomyMaster.learnSkills();
      return sendJson(res, 200, { ok: true, result: out });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/self-test') {
      const out = await autonomyMaster.fullSelfTest();
      return sendJson(res, 200, { ok: true, result: out });
    }

    if (req.method === 'GET' && url.pathname === '/api/providers/config') {
      reloadConfigSecrets();
      normalizeModelSettings();
      return sendJson(res, 200, getProviderConfigPayload());
    }

    if (req.method === 'POST' && url.pathname === '/api/providers/config') {
      const body = await parseBody(req);
      const up = body || {};
      if (typeof up.ollamaBaseUrl === 'string') config.model.ollamaBaseUrl = up.ollamaBaseUrl.trim();
      if (typeof up.openrouterBaseUrl === 'string') config.model.openrouterBaseUrl = up.openrouterBaseUrl.trim();
      if (typeof up.nvidiaBaseUrl === 'string') config.model.nvidiaBaseUrl = up.nvidiaBaseUrl.trim();
      if (typeof up.openaiBaseUrl === 'string') config.model.openaiBaseUrl = up.openaiBaseUrl.trim();
      if (typeof up.genericBaseUrl === 'string') config.model.openaiBaseUrl = up.genericBaseUrl.trim();
      const secretUpdates = {};
      if (typeof up.openrouterApiKey === 'string') secretUpdates.openrouterApiKey = up.openrouterApiKey.trim();
      if (typeof up.nvidiaApiKey === 'string') secretUpdates.nvidiaApiKey = up.nvidiaApiKey.trim();
      if (typeof up.openaiApiKey === 'string') secretUpdates.openaiApiKey = up.openaiApiKey.trim();
      if (typeof up.genericApiKey === 'string') secretUpdates.openaiApiKey = up.genericApiKey.trim();
      persistSecretUpdates(secretUpdates);
      normalizeModelSettings();
      saveConfig(config);
      agent.reloadTools();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/providers/import-openclaw') {
      const imported = importProviderSecretsFromOpenClaw();
      persistSecretUpdates({
        openrouterApiKey: imported.openrouterApiKey || '',
        nvidiaApiKey: imported.nvidiaApiKey || '',
        openaiApiKey: imported.openaiApiKey || '',
        githubToken: imported.githubToken || '',
        huggingfaceApiKey: imported.huggingfaceApiKey || '',
        elevenlabsApiKey: imported.elevenlabsApiKey || '',
        telegramBotToken: imported.telegramBotToken || ''
      });
      if (imported.openrouterBaseUrl) config.model.openrouterBaseUrl = imported.openrouterBaseUrl;
      if (imported.nvidiaBaseUrl) config.model.nvidiaBaseUrl = imported.nvidiaBaseUrl;
      if (imported.openaiBaseUrl) config.model.openaiBaseUrl = imported.openaiBaseUrl;
      if (imported.ollamaBaseUrl) config.model.ollamaBaseUrl = imported.ollamaBaseUrl;
      normalizeModelSettings();
      saveConfig(config);
      agent.reloadTools();
      return sendJson(res, 200, {
        ok: true,
        imported: {
          openrouterApiKey: Boolean(imported.openrouterApiKey),
          nvidiaApiKey: Boolean(imported.nvidiaApiKey),
          openaiApiKey: Boolean(imported.openaiApiKey),
          githubToken: Boolean(imported.githubToken),
          huggingfaceApiKey: Boolean(imported.huggingfaceApiKey),
          elevenlabsApiKey: Boolean(imported.elevenlabsApiKey),
          telegramBotToken: Boolean(imported.telegramBotToken),
          openrouterBaseUrl: imported.openrouterBaseUrl || config.model.openrouterBaseUrl,
          nvidiaBaseUrl: imported.nvidiaBaseUrl || config.model.nvidiaBaseUrl,
          openaiBaseUrl: imported.openaiBaseUrl || config.model.openaiBaseUrl,
          ollamaBaseUrl: imported.ollamaBaseUrl || config.model.ollamaBaseUrl
        }
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/models') {
      normalizeModelSettings();
      const provider = normalizeProviderId(url.searchParams.get('provider') || config.model.provider || 'ollama');
      if (!PROVIDER_ORDER.includes(provider)) {
        return sendJson(res, 400, { error: `unsupported_provider:${provider}` });
      }
      const models = await buildLegacyProviderModels(config.model, provider);
      return sendJson(res, 200, { provider, models });
    }

    if (req.method === 'GET' && url.pathname === '/api/model/current') {
      return sendJson(res, 200, agent.getCurrentModel());
    }

    if (req.method === 'POST' && url.pathname === '/api/model/switch') {
      const body = await parseBody(req);
      const out = agent.switchModel(normalizeProviderId(body.provider), String(body.model || '').replace(/^generic\//, 'openai/'));
      normalizeModelSettings();
      saveConfig(config);
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await parseBody(req);
      const sessionId = String(body.sessionId || '').trim();
      const message = String(body.message || '').trim();
      if (!sessionId) return sendJson(res, 400, { error: 'sessionId is required' });
      if (!message) return sendJson(res, 400, { error: 'message is required' });

      const existing = pendingChats.get(sessionId);
      if (existing) {
        return sendJson(res, 202, {
          ok: true,
          pending: true,
          sessionId,
          startedAt: existing.startedAt,
          note: 'chat_already_running_for_session'
        });
      }

      const entry = getOrStartChat(sessionId, message);
      try {
        const out = await withTimeout(entry.promise, 20 * 1000, 'chat_timeout');
        return sendJson(res, 200, { ...out, replyHtml: renderReplyHtml(out.reply) });
      } catch (error) {
        if (String(error.message || error) === 'chat_timeout') {
          return sendJson(res, 202, {
            ok: true,
            pending: true,
            sessionId,
            startedAt: entry.startedAt,
            note: 'chat_still_running'
          });
        }
        throw error;
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/chat/pending') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      if (!sessionId) return sendJson(res, 400, { error: 'sessionId is required' });
      const existing = pendingChats.get(sessionId);
      if (!existing) return sendJson(res, 200, { ok: true, pending: false, sessionId });
      return sendJson(res, 200, {
        ok: true,
        pending: true,
        sessionId,
        startedAt: existing.startedAt
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/tool/run') {
      const body = await parseBody(req);
      const out = await agent.runTool(body.name, body.args || {});
      return sendJson(res, 200, { ok: true, result: out });
    }

    if (req.method === 'GET' && url.pathname === '/api/context/status') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const out = agent.getContextStatus(sessionId);
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/context/compact') {
      const body = await parseBody(req);
      const out = agent.compactSessionContext({
        sessionId: body.sessionId,
        dryRun: Boolean(body.dryRun)
      });
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/context/compactions') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const limit = Number(url.searchParams.get('limit') || 20);
      const out = agent.listContextCompactions(sessionId, limit);
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/context/artifacts') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const limit = Number(url.searchParams.get('limit') || 40);
      const out = agent.listContextArtifacts(sessionId, limit);
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/skills') {
      const out = await agent.runTool('skill_list', {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/install') {
      const body = await parseBody(req);
      const out = await agent.runTool('skill_install', body || {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/review') {
      const body = await parseBody(req);
      const out = await agent.runTool('skill_review', { name: body.name });
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/approve') {
      const body = await parseBody(req);
      const out = await agent.runTool('skill_approve', { name: body.name });
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/execute') {
      const body = await parseBody(req);
      const out = await agent.runTool('skill_execute', { name: body.name, args: body.args || {} });
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/uninstall') {
      const body = await parseBody(req);
      const out = await agent.runTool('skill_uninstall', { name: body.name });
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/email/status') {
      const out = await agent.runTool('email_status', {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/email/send') {
      const body = await parseBody(req);
      const out = await agent.runTool('email_send', body || {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/email/list') {
      const body = await parseBody(req);
      const out = await agent.runTool('email_list', body || {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/email/read') {
      const body = await parseBody(req);
      const out = await agent.runTool('email_read', body || {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/gworkspace/call') {
      const body = await parseBody(req);
      const out = await agent.runTool('gworkspace_call', body || {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/research/run') {
      const body = await parseBody(req);
      const out = await agent.runTool('research_run_daily', { simulate: Boolean(body?.simulate) });
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/research/recent') {
      const out = await agent.runTool('research_list_recent', {
        limit: Number(url.searchParams.get('limit') || 10)
      });
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/research/queue') {
      const out = await agent.runTool('research_review_queue', {
        limit: Number(url.searchParams.get('limit') || 50)
      });
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/research/approve') {
      const body = await parseBody(req);
      const out = await agent.runTool('research_approve', {
        url: String(body?.url || ''),
        note: String(body?.note || '')
      });
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const limit = Number(url.searchParams.get('limit') || 80);
      return sendJson(res, 200, { sessions: memory.listSessions(limit) });
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const body = await parseBody(req);
      const sessionId = String(body?.sessionId || '').trim();
      if (!sessionId) return sendJson(res, 400, { error: 'sessionId is required' });
      const session = memory.createSession(sessionId);
      return sendJson(res, 200, { ok: true, session });
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions/import') {
      const body = await parseBody(req);
      const imported = memory.importSession({
        sessionId: String(body?.sessionId || '').trim(),
        messages: Array.isArray(body?.messages) ? body.messages : []
      });
      return sendJson(res, 200, { ok: true, session: imported });
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions/clone') {
      const body = await parseBody(req);
      const session = memory.cloneSession({
        sourceSessionId: String(body?.sourceSessionId || '').trim(),
        targetSessionId: String(body?.targetSessionId || '').trim()
      });
      return sendJson(res, 200, { ok: true, session });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
      if (url.pathname.endsWith('/activity')) {
        const parts = url.pathname.split('/');
        const sessionId = decodeURIComponent(parts[3] || '');
        const since = String(url.searchParams.get('since') || '');
        const pending = pendingChats.get(sessionId);
        const toolRuns = memory.getToolRunsSince(sessionId, since, 80);
        const messages = memory.getMessagesSince(sessionId, since, 80);
        return sendJson(res, 200, {
          sessionId,
          since: since || null,
          pending: Boolean(pending),
          pendingStartedAt: pending?.startedAt || null,
          toolRuns,
          messages
        });
      }
      if (url.pathname.endsWith('/export')) {
        const parts = url.pathname.split('/');
        const sessionId = decodeURIComponent(parts[3] || '');
        const summary = memory.getSessionSummary(sessionId);
        if (!summary) return sendJson(res, 404, { error: 'session_not_found' });
        const messages = memory.getAllMessagesForSession(sessionId);
        return sendJson(res, 200, {
          sessionId,
          summary,
          exportedAt: new Date().toISOString(),
          estimatedTokens: estimateMessagesTokens(messages.map((m) => ({ role: m.role, content: m.content }))),
          messages
        });
      }
      const sessionId = decodeURIComponent(url.pathname.split('/').pop() || '');
      const msgs = memory.getMessages(sessionId || '', 100)
        .map((m) => ({
          ...m,
          html: m.role === 'assistant' ? renderReplyHtml(m.content || '') : null
        }));
      return sendJson(res, 200, { sessionId, messages: msgs });
    }

    if (req.method === 'GET' && url.pathname === '/api/missions') {
      return sendJson(res, 200, { missions: missions.list() });
    }

    if (req.method === 'GET' && url.pathname === '/api/missions/status') {
      const id = url.searchParams.get('id') || '';
      const mission = missions.get(id);
      if (!mission) return sendJson(res, 404, { error: 'mission_not_found' });
      return sendJson(res, 200, { mission });
    }

    if (req.method === 'GET' && url.pathname === '/api/missions/timeline') {
      const id = String(url.searchParams.get('id') || '').trim();
      const mission = missions.get(id);
      if (!mission) return sendJson(res, 404, { error: 'mission_not_found' });
      return sendJson(res, 200, buildMissionTimeline(mission));
    }

    if (req.method === 'POST' && url.pathname === '/api/missions/start') {
      const body = await parseBody(req);
      const out = missions.start({
        goal: body.goal,
        maxSteps: body.maxSteps,
        intervalMs: body.intervalMs ?? config.runtime.missionDefaultIntervalMs,
        maxRetries: body.maxRetries ?? config.runtime.missionDefaultMaxRetries,
        continueUntilDone: body.continueUntilDone ?? config.runtime.missionDefaultContinueUntilDone,
        hardStepCap: body.hardStepCap ?? config.runtime.missionDefaultHardStepCap
      });
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/missions/stop') {
      const body = await parseBody(req);
      return sendJson(res, 200, missions.stop(body.id));
    }

    if (req.method === 'GET' && url.pathname === '/api/browser/status') {
      const out = await browser.status();
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/navigate') {
      const body = await parseBody(req);
      return sendJson(res, 200, await browser.navigate(body.url));
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/search') {
      const body = await parseBody(req);
      return sendJson(res, 200, await browser.search(body.query));
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/extract') {
      const body = await parseBody(req);
      return sendJson(res, 200, await browser.extractText(body.selector || 'body'));
    }

    if (req.method === 'GET' && url.pathname === '/api/browser/config') {
      return sendJson(res, 200, { cdpUrl: config.browser?.cdpUrl || 'http://127.0.0.1:9222' });
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/config') {
      const body = await parseBody(req);
      if (!config.browser) config.browser = {};
      if (typeof body.cdpUrl === 'string' && body.cdpUrl.trim()) {
        config.browser.cdpUrl = body.cdpUrl.trim();
      }
      saveConfig(config);
      browser = new CDPBrowser(config.browser.cdpUrl);
      agent.reloadTools();
      return sendJson(res, 200, { ok: true, cdpUrl: config.browser.cdpUrl });
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/launch') {
      const out = await launchDebugBrowser();
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/telegram/config') {
      reloadConfigSecrets();
      const tg = config.channels.telegram || { botToken: '', enabled: false };
      return sendJson(res, 200, { enabled: Boolean(tg.enabled), hasToken: Boolean(tg.botToken) });
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram/config') {
      const body = await parseBody(req);
      const tg = config.channels.telegram || {};
      const secretUpdates = {};
      if (typeof body.botToken === 'string') secretUpdates.telegramBotToken = body.botToken.trim();
      if (typeof body.enabled === 'boolean') tg.enabled = body.enabled;
      config.channels.telegram = tg;
      persistSecretUpdates(secretUpdates);
      saveConfig(config);
      return sendJson(res, 200, {
        ok: true,
        enabled: Boolean(config.channels?.telegram?.enabled),
        hasToken: Boolean(config.channels?.telegram?.botToken)
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/telegram/status') {
      return sendJson(res, 200, { running: telegramLoopRunning, stopRequested: telegramLoopStopRequested });
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram/start') {
      await runTelegramLoop();
      return sendJson(res, 200, { ok: true, running: telegramLoopRunning });
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram/stop') {
      await stopTelegramLoop();
      return sendJson(res, 200, { ok: true, running: telegramLoopRunning });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(process.cwd(), 'src/ui/index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  } catch (error) {
    logError('request_failed', { error: String(error.message || error) });
    sendJson(res, 500, { error: String(error.message || error) });
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
