import { execSync } from 'node:child_process';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { resolveExecutionEnvelope } from '../../core/model-execution-envelope.mjs';
import {
  RUNTIME_STATE_CONTRACT_VERSION,
  buildRuntimeStatePacket,
  validateCanonicalRuntimeState
} from '../../core/runtime-state-contract.mjs';
import { buildConfigParityReport } from '../../core/config-parity-check.mjs';
import { getMissionEffectiveStepLimit, getMissionLimitSource } from '../../core/missions.mjs';

function readGitOverview(workspaceRoot) {
  const cwd = String(workspaceRoot || process.cwd());
  try {
    const statusText = execSync(`git -C "${cwd}" status --branch --porcelain=v1`, { encoding: 'utf8' }).trim();
    const lines = statusText ? statusText.split('\n') : [];
    const branchLine = lines[0] || '';
    const branchMatch = branchLine.match(/^##\s+([^\.\s]+)(?:\.\.\.[^\s]+)?(?:\s+\[ahead (\d+)\])?(?:,\s+behind (\d+))?/);
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

export function createRuntimeService({
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
}) {
  let gitOverviewCache = {
    workspaceRoot: '',
    expiresAt: 0,
    value: null
  };

  function getCachedGitOverview(workspaceRoot) {
    const cwd = String(workspaceRoot || process.cwd());
    const ttlMs = Math.max(1000, Number(config?.runtime?.gitOverviewCacheTtlMs || 15000));
    if (gitOverviewCache.value && gitOverviewCache.workspaceRoot === cwd && Date.now() < gitOverviewCache.expiresAt) {
      return gitOverviewCache.value;
    }
    const value = readGitOverview(cwd);
    gitOverviewCache = {
      workspaceRoot: cwd,
      expiresAt: Date.now() + ttlMs,
      value
    };
    return value;
  }

  async function buildRuntimeOverview(getBrowser) {
    normalizeModelSettings();
    const [browserStatus, catalog] = await Promise.all([
      getBrowser().status().catch((error) => ({ ok: false, error: String(error.message || error) })),
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
      git: getCachedGitOverview(config.runtime?.workspaceRoot || process.cwd()),
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
    const effectiveFallbackProviders = Array.isArray(parity.summary?.effectiveFallbackProviders)
      ? parity.summary.effectiveFallbackProviders
      : [];
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
        `fallback_enabled:${String(config.model?.routing?.fallbackEnabled !== false)}`,
        `fallback_count:${effectiveFallbackProviders.length}`,
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
    const effectiveStepLimit = getMissionEffectiveStepLimit(mission);
    return {
      mission: {
        id: mission.id,
        goal: mission.goal,
        status: mission.status,
        step: mission.step,
        maxSteps: mission.maxSteps,
        hardStepCap: mission.hardStepCap,
        effectiveStepLimit,
        limitSource: getMissionLimitSource(mission),
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
      config.model.routing.fallbackProviders = [];
      normalizeModelSettings();
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
      config.model.routing.fallbackProviders = [];
      normalizeModelSettings();
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
    normalizeModelSettings();
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

  return {
    buildCapabilitiesPayload,
    buildRuntimeOverview,
    buildRuntimeInventory,
    buildAutonomyInsights,
    buildRuntimeStateContractReport,
    buildRuntimeStateAttachment,
    buildMissionTimeline,
    applyAutonomyMode,
    renderReplyHtml
  };
}
