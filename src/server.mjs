import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { loadConfig, saveConfig, defaultConfig } from './config.mjs';
import { MemoryStore } from './memory/store.mjs';
import { OpenUnumAgent } from './core/agent.mjs';
import { MissionRunner } from './core/missions.mjs';
import { SelfHealOrchestrator } from './core/self-heal-orchestrator.mjs';
import { getAutonomyMaster } from './core/autonomy-master.mjs';
import { estimateMessagesTokens } from './core/context-budget.mjs';
import { resolveExecutionEnvelope } from './core/model-execution-envelope.mjs';
import {
  RUNTIME_STATE_CONTRACT_VERSION,
  buildRuntimeStatePacket,
  validateCanonicalRuntimeState
} from './core/runtime-state-contract.mjs';
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
import { handleProvidersRoute } from './server/routes/providers.mjs';
import { handleStateRoute } from './server/routes/state.mjs';
import { handleRolesRoute } from './server/routes/roles.mjs';
import { handleApprovalsRoute } from './server/routes/approvals.mjs';
import { handleVerifierRoute } from './server/routes/verifier.mjs';
import { handleAuditRoute } from './server/routes/audit.mjs';
import { handleMemoryFreshnessRoute } from './server/routes/memory-freshness.mjs';
import { handleCommandRoute, handleCommandsListRoute } from './server/routes/commands.mjs';
import { loadBuiltinCommands } from './commands/loader.mjs';
import { createConfigService } from './server/services/config_service.mjs';
import { createAuthService } from './server/services/auth_service.mjs';
import { createAuthJobsService } from './server/services/auth_jobs.mjs';
import { createBrowserRuntimeService } from './server/services/browser_runtime.mjs';
import { createTelegramRuntimeService } from './server/services/telegram_runtime.mjs';
import { createResearchRuntimeService } from './server/services/research_runtime.mjs';
import { createChatRuntimeService } from './server/services/chat_runtime.mjs';

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

const agent = new OpenUnumAgent({ config, memoryStore: memory });
loadBuiltinCommands();
const missions = new MissionRunner({ agent, memoryStore: memory, config });
let browser = new CDPBrowser(config.browser?.cdpUrl);

// Chat runtime must be initialized before autonomyMaster (pendingChats dependency)
const chatRuntime = createChatRuntimeService({
  agent,
  saveConfig: () => saveConfig(config)
});
const pendingChats = chatRuntime.pendingChats;
const withTimeout = chatRuntime.withTimeout;
const getOrStartChat = chatRuntime.getOrStartChat;
const prunePendingChats = chatRuntime.prunePendingChats;

const autonomyMaster = getAutonomyMaster({ config, agent, memoryStore: memory, browser, pendingChats });
const selfHeal = new SelfHealOrchestrator({ config, agent, browser, memory });
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

// Services are now initialized above

// buildAuthCatalogPayload is now in authService

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

function buildRuntimeStateContractReport({ sessionId = '', goal = '', phase = '', nextAction = '' } = {}) {
  const sid = String(sessionId || '').trim() || `runtime:${process.pid}`;
  const effectiveGoal = String(goal || '').trim() || 'Maintain stable OpenUnum runtime operation';
  const effectivePhase = String(phase || '').trim() || 'phase0';
  const effectiveNextAction = String(nextAction || '').trim() || 'Review diagnostics and proceed with planned work';
  const parity = buildConfigParityReport(config, process.env);
  const blockers = (parity.issues || [])
    .filter((issue) => issue?.level === 'error')
    .map((issue) => String(issue?.code || '').trim())
    .filter(Boolean);

  const packet = buildRuntimeStatePacket({
    sessionId: sid,
    goal: effectiveGoal,
    phase: effectivePhase,
    nextAction: effectiveNextAction,
    verifiedObservations: [
      `active_provider:${String(config.model?.provider || 'unknown')}`,
      `fallback_count:${Array.isArray(config.model?.routing?.fallbackProviders) ? config.model.routing.fallbackProviders.length : 0}`,
      `parity_severity:${String(parity.severity || 'unknown')}`
    ],
    permissions: {
      shell: Boolean(config.runtime?.shellEnabled),
      network: true,
      browser: Boolean(config.browser),
      fileWrite: true
    },
    blockers,
    activeArtifacts: [
      'src/core/runtime-state-contract.mjs',
      'src/core/config-parity-check.mjs',
      'scripts/phase0-foundation-check.mjs'
    ]
  });
  const validation = validateCanonicalRuntimeState(packet.state);
  return {
    contractVersion: RUNTIME_STATE_CONTRACT_VERSION,
    validation,
    packet
  };
}

function buildRuntimeStateAttachment({ sessionId = '', goal = '', phase = '', nextAction = '' } = {}) {
  const report = buildRuntimeStateContractReport({ sessionId, goal, phase, nextAction });
  return {
    contractVersion: report.contractVersion,
    validationOk: Boolean(report.validation?.ok),
    fingerprint: report.packet?.fingerprint || null,
    state: report.packet?.state || null
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

const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isAllowedLocalOrigin(origin) {
  const raw = String(origin || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const requestOrigin = String(req.headers.origin || '').trim();
    const corsOrigin = isAllowedLocalOrigin(requestOrigin) ? requestOrigin : null;
    const parseRequestBody = (request) => parseBody(request, {
      maxBytes: Number(config.runtime?.maxRequestBodyBytes || 1024 * 1024)
    });

    if (req.method === 'OPTIONS') {
      if (requestOrigin && !corsOrigin) {
        return sendApiError(res, 403, 'origin_not_allowed', 'Browser origin is not allowed for this local control plane');
      }
      res.writeHead(204, noCacheHeaders('text/plain', { corsOrigin }));
      res.end();
      return;
    }

    if (MUTATING_HTTP_METHODS.has(String(req.method || '').toUpperCase()) && requestOrigin && !corsOrigin) {
      return sendApiError(res, 403, 'origin_not_allowed', 'Browser origin is not allowed for mutating local control-plane requests');
    }

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

    if (req.method === 'GET' && url.pathname === '/api/runtime/overview') {
      return sendJson(res, 200, await buildRuntimeOverview());
    }

    if (req.method === 'GET' && url.pathname === '/api/runtime/inventory') {
      const limit = Number(url.searchParams.get('limit') || 300);
      return sendJson(res, 200, buildRuntimeInventory(limit));
    }

    if (req.method === 'GET' && url.pathname === '/api/runtime/state-contract') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const goal = String(url.searchParams.get('goal') || '').trim();
      const phase = String(url.searchParams.get('phase') || '').trim();
      const nextAction = String(url.searchParams.get('nextAction') || '').trim();
      return sendJson(res, 200, buildRuntimeStateContractReport({
        sessionId,
        goal,
        phase,
        nextAction
      }));
    }

    if (req.method === 'GET' && url.pathname === '/api/runtime/config-parity') {
      return sendJson(res, 200, buildConfigParityReport(config, process.env));
    }

    if (req.method === 'GET' && url.pathname === '/api/autonomy/insights') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const goal = String(url.searchParams.get('goal') || '').trim();
      return sendJson(res, 200, buildAutonomyInsights({ sessionId, goal }));
    }

    // PHASE 3: Predictive Failure Insights
    if (req.method === 'GET' && url.pathname === '/api/autonomy/predictive-failures') {
      const predictions = agent.predictiveFailure?.getCurrentPredictions() || [];
      const stats = agent.predictiveFailure?.getAccuracyStats() || { totalPredictions: 0, totalFailures: 0, accuracy: 0 };
      return sendJson(res, 200, {
        ok: true,
        predictions,
        stats,
        timestamp: new Date().toISOString()
      });
    }

    // PHASE 3: Task Orchestrator - List Tasks
    if (req.method === 'GET' && url.pathname === '/api/autonomy/tasks') {
      const limit = Number(url.searchParams.get('limit') || 20);
      const result = agent.taskOrchestrator?.listTasks(limit) || { ok: false, error: 'task_orchestrator_not_initialized' };
      return sendJson(res, result.ok ? 200 : 500, result);
    }

    // PHASE 3: Task Orchestrator - Get Task Status
    if (req.method === 'GET' && url.pathname === '/api/autonomy/tasks/status') {
      const taskId = String(url.searchParams.get('id') || '').trim();
      if (!taskId) return sendJson(res, 400, { ok: false, error: 'id is required' });
      const result = agent.taskOrchestrator?.getTask(taskId) || { ok: false, error: 'task_orchestrator_not_initialized' };
      return sendJson(res, result.ok ? 200 : 404, result);
    }

    // PHASE 3: Task Orchestrator - Run Task
    if (req.method === 'POST' && url.pathname === '/api/autonomy/tasks/run') {
      const body = await parseRequestBody(req);
      const result = await agent.taskOrchestrator?.runTask(body || {}) || { ok: false, error: 'task_orchestrator_not_initialized' };
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    // PHASE 3: Worker Orchestrator - List Workers
    if (req.method === 'GET' && url.pathname === '/api/autonomy/workers') {
      const limit = Number(url.searchParams.get('limit') || 20);
      const result = agent.workerOrchestrator?.listWorkers(limit) || { ok: false, error: 'worker_orchestrator_not_initialized' };
      return sendJson(res, result.ok ? 200 : 500, result);
    }

    // PHASE 3: Worker Orchestrator - Start Worker
    if (req.method === 'POST' && url.pathname === '/api/autonomy/workers/start') {
      const body = await parseRequestBody(req);
      const result = agent.workerOrchestrator?.startWorker(body || {}) || { ok: false, error: 'worker_orchestrator_not_initialized' };
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    // PHASE 3: Worker Orchestrator - Stop Worker
    if (req.method === 'POST' && url.pathname === '/api/autonomy/workers/stop') {
      const body = await parseRequestBody(req);
      const result = agent.workerOrchestrator?.stopWorker(body?.id) || { ok: false, error: 'worker_orchestrator_not_initialized' };
      return sendJson(res, result.ok ? 200 : 404, result);
    }

    // PHASE 3: Worker Orchestrator - Tick Worker
    if (req.method === 'POST' && url.pathname === '/api/autonomy/workers/tick') {
      const body = await parseRequestBody(req);
      const result = await agent.workerOrchestrator?.tickWorker(body?.id) || { ok: false, error: 'worker_orchestrator_not_initialized' };
      return sendJson(res, result.ok ? 200 : 404, result);
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
      const body = await parseRequestBody(req);
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
      const body = await parseRequestBody(req);
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
      const body = await parseRequestBody(req);
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
        memoryStore: memory,
        parseBody: parseRequestBody,
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
      ctx: { noCacheHeaders }
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
});
