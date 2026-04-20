import http from 'node:http';
import sanitizeHtml from 'sanitize-html';
import { loadConfig, saveConfig } from './config.mjs';
import { MemoryStore } from './memory/store.mjs';
import { OpenUnumAgent } from './core/agent.mjs';
import { MissionRunner } from './core/missions.mjs';
import { SelfHealOrchestrator } from './core/self-heal-orchestrator.mjs';
import { getAutonomyMaster } from './core/autonomy-master.mjs';
import { estimateMessagesTokens } from './core/context-budget.mjs';
import { buildConfigParityReport } from './core/config-parity-check.mjs';
import { CDPBrowser } from './browser/cdp.mjs';
import { logInfo, logError } from './logger.mjs';
import {
  noCacheHeaders,
  parseBody,
  sendApiError as sendApiErrorBase,
  sendJson
} from './server/http.mjs';
import {
  AUTH_TARGET_DEFS,
  GOOGLE_WORKSPACE_DEFAULT_SCOPES,
  applySecretsToConfig,
  getGoogleWorkspaceOAuthConfig,
  normalizeGoogleWorkspaceOAuthConfig,
  saveGoogleWorkspaceOAuth,
  saveGoogleWorkspaceOAuthConfig,
  saveOpenAICodexOAuth,
  scanLocalAuthSources,
  scrubSecretsFromConfig,
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
import { handleProvidersRoute } from './server/routes/providers.mjs';
import { handleStateRoute } from './server/routes/state.mjs';
import { handleRolesRoute } from './server/routes/roles.mjs';
import { handleApprovalsRoute } from './server/routes/approvals.mjs';
import { handleVerifierRoute } from './server/routes/verifier.mjs';
import { handleAuditRoute } from './server/routes/audit.mjs';
import { handleMemoryFreshnessRoute } from './server/routes/memory-freshness.mjs';
import { handleEvalRoute } from './server/routes/eval.mjs';
import { handleCommandRoute, handleCommandsListRoute } from './server/routes/commands.mjs';
import { handleRuntimeRoute } from './server/routes/runtime.mjs';
import { loadBuiltinCommands } from './commands/loader.mjs';
import { createConfigService } from './server/services/config_service.mjs';
import { createAuthService } from './server/services/auth_service.mjs';
import { createAuthJobsService } from './server/services/auth_jobs.mjs';
import { createBrowserRuntimeService } from './server/services/browser_runtime.mjs';
import { createTelegramRuntimeService } from './server/services/telegram_runtime.mjs';
import { createResearchRuntimeService } from './server/services/research_runtime.mjs';
import { createChatRuntimeService } from './server/services/chat_runtime.mjs';
import { createRuntimeService } from './server/services/runtime_service.mjs';
import { enforceBrowserRequestGuards } from './server/services/request_guard_service.mjs';
import { createLocalModelService } from './server/services/local_model_service.mjs';

const config = loadConfig();
const memory = new MemoryStore();

const configService = createConfigService({
  config,
  PROVIDER_ORDER,
  reloadConfigSecrets: () => reloadConfigSecrets()
});
const normalizeModelSettings = configService.normalizeModelSettings;
const behaviorOverrideKey = configService.behaviorOverrideKey;
const getProviderConfigPayload = configService.getProviderConfigPayload;
const persistSecretUpdates = configService.persistSecretUpdates;
const applyConfigPatch = configService.applyConfigPatch;
const applyProvidersConfigPatch = configService.applyProvidersConfigPatch;

normalizeModelSettings();

const authService = createAuthService({
  config,
  PROVIDER_ORDER,
  reloadConfigSecrets: () => reloadConfigSecrets()
});
const buildAuthMethodRows = authService.buildAuthMethodRows;
const providerConnectionOverrides = authService.providerConnectionOverrides;
const secretForService = authService.secretForService;
const testProviderConnection = authService.testProviderConnection;
const testServiceConnection = authService.testServiceConnection;
const oauthCommandForService = authService.oauthCommandForService;
const launchInTerminal = authService.launchInTerminal;
const launchOauthCommand = authService.launchOauthCommand;
const buildAuthCatalogPayload = authService.buildAuthCatalogPayload;

// Note: agent is created with default sleepCycle, then updated after autonomyMaster is initialized
const agent = new OpenUnumAgent({ config, memoryStore: memory, sleepCycle: 60 });
loadBuiltinCommands();
const missions = new MissionRunner({ agent, memoryStore: memory, config });
let browser = new CDPBrowser(config.browser?.cdpUrl);
function setBrowserRuntime(nextBrowser) {
  browser = nextBrowser;
  if (selfHeal) {
    selfHeal.browser = nextBrowser;
    if (selfHeal.monitor) selfHeal.monitor.browser = nextBrowser;
  }
}

// Chat runtime must be initialized before autonomyMaster (pendingChats dependency)
const chatRuntime = createChatRuntimeService({
  agent,
  saveConfig: () => saveConfig(config),
  config
});
const pendingChats = chatRuntime.pendingChats;
const withTimeout = chatRuntime.withTimeout;
const getOrStartChat = chatRuntime.getOrStartChat;
const prunePendingChats = chatRuntime.prunePendingChats;

const autonomyMaster = getAutonomyMaster({ config, agent, memoryStore: memory, browser, pendingChats });
// Update agent's sleepCycle now that autonomyMaster is initialized
agent.sleepCycle = autonomyMaster.sleepCycle;
let server = null;
const selfHeal = new SelfHealOrchestrator({
  config,
  agent,
  browser,
  memory,
  probes: {
    serverResponsive: async () => ({
      ok: Boolean(server?.listening),
      host: config.server.host,
      port: config.server.port,
      uptimeSeconds: Math.round(process.uptime())
    })
  }
});
const API_ERROR_CONTRACT_VERSION = '2026-04-02.api-errors.v1';
const TOOL_CATALOG_CONTRACT_VERSION = '2026-04-02.tool-catalog.v1';

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
  setBrowser: (nextBrowser) => { setBrowserRuntime(nextBrowser); }
});
const launchDebugBrowser = browserRuntime.launchDebugBrowser;
const ensureBrowserReady = browserRuntime.ensureBrowserReady;

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

const runtimeService = createRuntimeService({
  config,
  memory,
  agent,
  autonomyMaster,
  saveConfig,
  PROVIDER_ORDER,
  AUTH_TARGET_DEFS,
  MODEL_CATALOG_CONTRACT_VERSION,
  TOOL_CATALOG_CONTRACT_VERSION,
  normalizeProviderId,
  normalizeModelSettings,
  buildModelCatalog
});
const buildCapabilitiesPayload = runtimeService.buildCapabilitiesPayload;
const buildRuntimeOverview = () => runtimeService.buildRuntimeOverview(() => browser);
const buildRuntimeInventory = runtimeService.buildRuntimeInventory;
const buildAutonomyInsights = runtimeService.buildAutonomyInsights;
const buildRuntimeStateContractReport = runtimeService.buildRuntimeStateContractReport;
const buildRuntimeStateAttachment = runtimeService.buildRuntimeStateAttachment;
const buildMissionTimeline = runtimeService.buildMissionTimeline;
const applyAutonomyMode = runtimeService.applyAutonomyMode;
const renderReplyHtml = runtimeService.renderReplyHtml;
const localModelService = createLocalModelService({ config });

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
  return selfHeal.runHealthCheck();
}

async function runSelfHeal(dryRun = false) {
  const result = await selfHeal.runSelfHeal(dryRun);
  if (pendingChats.size > 10) {
    result.actions = result.actions || [];
    result.results = result.results || [];
    result.actions.push({ action: 'pending_chats_high', count: pendingChats.size, status: 'warning' });
    result.results.push({ action: 'pending_chats_high', success: false, hint: 'Wait for chats to complete or restart server' });
    result.ok = false;
  } else {
    result.results = result.results || [];
    result.results.push({ action: 'pending_chats_ok', count: pendingChats.size, success: true });
  }
  return result;
}


server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const parseRequestBody = (request) => parseBody(request, {
      maxBytes: Number(config.runtime?.maxRequestBodyBytes || 1024 * 1024)
    });
    const guard = enforceBrowserRequestGuards({ req, res, config, noCacheHeaders, sendApiError });
    if (guard.handled) return;

    if (await handleHealthRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        pendingChats,
        parseBody: parseRequestBody,
        sendJson,
        runHealthCheck,
        runSelfHeal,
        selfHealStatus: () => selfHeal.getStatus({
          pendingChatsCount: pendingChats.size,
          telegramRunning: telegramLoopRunning()
        }),
        logInfo,
        telegramLoopRunning
      }
    })) return;

    if (await handleRuntimeRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        parseBody: parseRequestBody,
        sendJson,
        saveConfig,
        normalizeProviderId,
        behaviorOverrideKey,
        buildCapabilitiesPayload,
        buildRuntimeOverview,
        buildRuntimeInventory,
        buildRuntimeStateContractReport,
        buildAutonomyInsights,
        buildConfigParityReport,
        TOOL_CATALOG_CONTRACT_VERSION,
        localModelService
      }
    })) return;

    if (await handleVerifierRoute({
      req,
      res,
      url,
      ctx: {
        parseBody: parseRequestBody,
        sendJson
      }
    })) return;

    if (await handleAuditRoute({
      req,
      res,
      url,
      ctx: {
        parseBody: parseRequestBody,
        sendJson
      }
    })) return;

    if (await handleMemoryFreshnessRoute({
      req,
      res,
      url,
      ctx: {
        memory,
        sendJson
      }
    })) return;

    if (await handleEvalRoute({
      req,
      res,
      url,
      memory,
      sendApiError: sendApiErrorBase
    })) return;

    if (await handleModelRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        memoryStore: memory,
        parseBody: parseRequestBody,
        sendJson,
        saveConfig,
        buildModelCatalog,
        buildLegacyProviderModels,
        normalizeModelSettings,
        normalizeProviderId,
        PROVIDER_ORDER,
        localModelService
      }
    })) return;

    if (await handleAuthRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        memoryStore: memory,
        parseBody: parseRequestBody,
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
        memoryStore: memory,
        parseBody: parseRequestBody,
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
        applyConfigPatch,
        applyProvidersConfigPatch,
        importProviderSecretsFromOpenClaw
      }
    })) return;

    if (await handleProvidersRoute({
      req,
      res,
      url,
      ctx: {
        sendJson
      }
    })) return;

    if (await handleStateRoute({
      req,
      res,
      url,
      ctx: {
        parseBody: parseRequestBody,
        sendJson
      }
    })) return;

    if (await handleRolesRoute({
      req,
      res,
      url,
      ctx: {
        parseBody: parseRequestBody,
        sendJson
      }
    })) return;

    if (await handleApprovalsRoute({
      req,
      res,
      url,
      ctx: {
        parseBody: parseRequestBody,
        sendJson
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
        parseBody: parseRequestBody,
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
        parseBody: parseRequestBody,
        sendJson,
        pendingChats,
        getOrStartChat,
        chatRuntime,
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
        parseBody: parseRequestBody,
        sendJson
      }
    })) return;

    if (await handleCommandRoute({
      req,
      res,
      url,
      ctx: {
        parseBody: parseRequestBody,
        sendJson,
        agent,
        memoryStore: memory,
        config
      }
    })) return;

    if (await handleCommandsListRoute({
      req,
      res,
      url,
      ctx: {
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
        parseBody: parseRequestBody,
        sendJson,
        sendApiError,
        prunePendingChats,
        estimateMessagesTokens,
        renderReplyHtml,
        buildRuntimeStateAttachment
      }
    })) return;

    if (await handleMissionsRoute({
      req,
      res,
      url,
      ctx: {
        config,
        missions,
        parseBody: parseRequestBody,
        sendJson,
        buildMissionTimeline,
        buildRuntimeStateAttachment
      }
    })) return;

    if (await handleBrowserRoute({
      req,
      res,
      url,
      ctx: {
        config,
        agent,
        parseBody: parseRequestBody,
        sendJson,
        saveConfig,
        CDPBrowser,
        launchDebugBrowser,
        ensureBrowserReady,
        getBrowser: () => browser,
        setBrowser: (nextBrowser) => { setBrowserRuntime(nextBrowser); }
      }
    })) return;

    if (await handleTelegramRoute({
      req,
      res,
      url,
      ctx: {
        config,
        parseBody: parseRequestBody,
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
      ctx: { noCacheHeaders, sendJson }
    })) return;

    return sendApiError(res, 404, 'not_found', 'Unknown API route');
  } catch (error) {
    logError('request_failed', { error: String(error.message || error) });
    if (String(error?.code || '') === 'invalid_json') {
      return sendApiError(res, 400, 'invalid_json', 'Request body must be valid JSON');
    }
    if (String(error?.code || '') === 'payload_too_large') {
      return sendApiError(res, 413, 'payload_too_large', 'Request body exceeds configured size limit');
    }
    return sendApiError(res, 500, 'internal_error', String(error.message || error));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logError('port_conflict', { port: config.server.port, msg: 'address already in use — retrying in 10s' });
    setTimeout(() => server.listen(config.server.port, config.server.host), 10000);
  } else {
    logError('server_fatal', { error: String(err.message || err) });
    process.exit(1);
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
  // Start Telegram bot polling loop if enabled and token is present
  if (config.channels?.telegram?.enabled && config.channels?.telegram?.botToken) {
    runTelegramLoop().catch((err) => {
      logError('telegram_startup_failed', { error: String(err.message || err) });
    });
  }
  // R9: Sleep Cycle Heartbeat - check for idle sleep every minute
  if (config.runtime?.sleepCycleEnabled !== false) {
    setInterval(() => {
      autonomyMaster.sleepCycle?.checkAndSleep().catch((err) => {
        logError('sleep_cycle_check_failed', { error: String(err.message || err) });
      });
    }, 60000);
  }
});
