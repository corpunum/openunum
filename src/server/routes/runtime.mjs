import { resolveExecutionEnvelope } from '../../core/model-execution-envelope.mjs';
import { MODEL_BACKED_TOOL_CONTRACTS } from '../../tools/backends/contracts.mjs';
import { resolveBackendProfiles } from '../../tools/backends/profiles.mjs';
import { loadSkills } from '../../skills/loader.mjs';

export async function handleRuntimeRoute({ req, res, url, ctx }) {
  const done = (status, payload) => {
    ctx.sendJson(res, status, payload);
    return true;
  };

  const modelBackedContracts = new Set(Object.keys(MODEL_BACKED_TOOL_CONTRACTS || {}));
  const telemetrySnapshot = () => ctx.agent?.toolRuntime?.modelBackedRegistry?.telemetrySnapshot?.() || {};
  const telemetryForTool = (toolName) => ctx.agent?.toolRuntime?.modelBackedRegistry?.telemetryForTool?.(toolName) || [];

  function summarizeContract(contract = null) {
    if (!contract) return null;
    return {
      name: contract.name,
      purpose: contract.purpose,
      inputSchema: contract.parameters || {},
      outputSchema: contract.outputSchema || {},
      sideEffects: contract.sideEffects || 'unknown',
      resourceClass: contract.resourceClass || 'unknown',
      template: {
        validationRules: {
          requiredDataFields: contract.outputSchema?.requiredDataFields || [],
          confidenceMin: Number(contract.outputSchema?.confidenceMin || 0)
        },
        errorSemantics: ['backend_unavailable', 'resource_denied', 'validation_failed', 'backend_failed'],
        fallbackRules: ['try_next_profile_on_failure', 'preserve_logical_tool_identity']
      }
    };
  }

  function augmentToolCatalog(tools = [], { allowedTools = null } = {}) {
    const mbt = ctx.config.runtime?.modelBackedTools || {};
    const enabled = mbt.enabled === true;
    const exposeToController = mbt.exposeToController !== false;
    const allowSet = Array.isArray(allowedTools) && allowedTools.length
      ? new Set(allowedTools.map((item) => String(item || '').trim()).filter(Boolean))
      : null;
    return (tools || []).map((tool) => {
      const name = String(tool?.name || '').trim();
      const isContractTool = modelBackedContracts.has(name);
      const toolCfg = mbt.tools?.[name] || {};
      const configuredProfiles = Array.isArray(toolCfg.backendProfiles) ? toolCfg.backendProfiles : [];
      const effectiveProfiles = isContractTool ? resolveBackendProfiles(ctx.config, name) : [];
      const contract = isContractTool ? summarizeContract(MODEL_BACKED_TOOL_CONTRACTS[name]) : null;
      return {
        ...tool,
        model_backed: {
          contract: isContractTool,
          enabled: isContractTool && enabled,
          exposeToController: isContractTool && enabled && exposeToController,
          configuredProfiles,
          effectiveProfiles,
          contractTemplate: contract,
          telemetry: telemetryForTool(name)
        },
        allowedInCurrentEnvelope: allowSet ? allowSet.has(name) : true
      };
    });
  }

  function parseSkillListPayload(raw = null) {
    if (!raw || typeof raw !== 'object') return [];
    if (Array.isArray(raw.skills)) return raw.skills;
    if (raw.ok === true && Array.isArray(raw.data?.skills)) return raw.data.skills;
    const maybeJson = typeof raw.data === 'string' ? raw.data.trim() : '';
    if (maybeJson.startsWith('{') || maybeJson.startsWith('[')) {
      try {
        const decoded = JSON.parse(maybeJson);
        if (Array.isArray(decoded?.skills)) return decoded.skills;
      } catch {
        return [];
      }
    }
    return [];
  }

  if (req.method === 'GET' && url.pathname === '/api/capabilities') {
    return done(200, ctx.buildCapabilitiesPayload());
  }

  if (req.method === 'GET' && url.pathname === '/api/tools/catalog') {
    const executionEnvelope = resolveExecutionEnvelope({
      provider: ctx.config.model?.provider,
      model: ctx.config.model?.model,
      runtime: ctx.config.runtime
    });
    const tools = ctx.agent.toolRuntime.toolCatalog({ allowedTools: executionEnvelope.toolAllowlist });
    return done(200, {
      contract_version: ctx.TOOL_CATALOG_CONTRACT_VERSION,
      enforce_profiles: ctx.config.runtime?.enforceModelExecutionProfiles !== false,
      allowed_tools: executionEnvelope.toolAllowlist || null,
      tools: augmentToolCatalog(tools, { allowedTools: executionEnvelope.toolAllowlist })
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/tooling-inventory') {
    const executionEnvelope = resolveExecutionEnvelope({
      provider: ctx.config.model?.provider,
      model: ctx.config.model?.model,
      runtime: ctx.config.runtime
    });
    const tools = augmentToolCatalog(
      ctx.agent.toolRuntime.toolCatalog({}),
      { allowedTools: executionEnvelope.toolAllowlist }
    );
    let managedSkills = [];
    try {
      const skillOut = await ctx.agent.runTool('skill_list', {});
      managedSkills = parseSkillListPayload(skillOut);
    } catch {
      managedSkills = [];
    }
    const discoveredSkillDocs = loadSkills();
    const discoveredSkills = (Array.isArray(discoveredSkillDocs) ? discoveredSkillDocs : []).map((row) => ({
      name: String(row?.name || '').trim(),
      source: row?.source || 'filesystem',
      approved: row?.approved ?? null,
      verdict: row?.verdict || 'n/a',
      usageCount: Number(row?.usageCount || 0),
      lastUsedAt: row?.lastUsedAt || null,
      installedAt: row?.installedAt || null
    })).filter((row) => row.name);
    const skillOps = tools
      .filter((tool) => String(tool?.name || '').startsWith('skill_'))
      .map((tool) => ({
        name: String(tool.name || ''),
        source: 'runtime-tool',
        approved: null,
        verdict: 'operation',
        usageCount: 0,
        description: String(tool.description || '')
      }));
    const mergedSkills = new Map();
    for (const row of managedSkills) {
      const key = String(row?.name || '').trim();
      if (!key) continue;
      mergedSkills.set(key, { ...row, source: row?.source || 'managed' });
    }
    for (const row of discoveredSkills) {
      const key = String(row?.name || '').trim();
      if (!key || mergedSkills.has(key)) continue;
      mergedSkills.set(key, row);
    }
    for (const row of skillOps) {
      const key = String(row?.name || '').trim();
      if (!key || mergedSkills.has(key)) continue;
      mergedSkills.set(key, row);
    }
    const skills = [...mergedSkills.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const localModels = await ctx.localModelService.getLocalModelStatus();
    return done(200, {
      ok: true,
      generated_at: new Date().toISOString(),
      allowed_tools: executionEnvelope.toolAllowlist || null,
      modelBackedTools: {
        enabled: ctx.config.runtime?.modelBackedTools?.enabled === true,
        exposeToController: ctx.config.runtime?.modelBackedTools?.exposeToController !== false,
        localMaxConcurrency: Number(ctx.config.runtime?.modelBackedTools?.localMaxConcurrency || 1),
        queueDepth: Number(ctx.config.runtime?.modelBackedTools?.queueDepth || 8),
        autoProfileTuningEnabled: ctx.config.runtime?.modelBackedTools?.autoProfileTuningEnabled !== false,
        profileSwitchMinSamples: Number(ctx.config.runtime?.modelBackedTools?.profileSwitchMinSamples || 6),
        latencyWeight: Number(ctx.config.runtime?.modelBackedTools?.latencyWeight || 0.35),
        costWeight: Number(ctx.config.runtime?.modelBackedTools?.costWeight || 0.25),
        failurePenalty: Number(ctx.config.runtime?.modelBackedTools?.failurePenalty || 0.8),
        recommendedLocalModels: ctx.localModelService.recommendedLocalModels(),
        tools: ctx.config.runtime?.modelBackedTools?.tools || {},
        contractTemplates: Object.fromEntries(
          Object.entries(MODEL_BACKED_TOOL_CONTRACTS).map(([key, contract]) => [key, summarizeContract(contract)])
        ),
        telemetry: telemetrySnapshot()
      },
      tools,
      skills,
      skillsBreakdown: {
        managed: managedSkills,
        discovered: discoveredSkills,
        operations: skillOps
      },
      localModels
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/overview') {
    return done(200, await ctx.buildRuntimeOverview());
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/inventory') {
    const limit = Number(url.searchParams.get('limit') || 300);
    return done(200, ctx.buildRuntimeInventory(limit));
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/state-contract') {
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    const goal = String(url.searchParams.get('goal') || '').trim();
    const phase = String(url.searchParams.get('phase') || '').trim();
    const nextAction = String(url.searchParams.get('nextAction') || '').trim();
    return done(200, ctx.buildRuntimeStateContractReport({
      sessionId,
      goal,
      phase,
      nextAction
    }));
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/config-parity') {
    return done(200, ctx.buildConfigParityReport(ctx.config, process.env));
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/insights') {
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    const goal = String(url.searchParams.get('goal') || '').trim();
    return done(200, ctx.buildAutonomyInsights({ sessionId, goal }));
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/predictive-failures') {
    const predictions = ctx.agent.predictiveFailure?.getCurrentPredictions() || [];
    const stats = ctx.agent.predictiveFailure?.getAccuracyStats() || { totalPredictions: 0, totalFailures: 0, accuracy: 0 };
    return done(200, {
      ok: true,
      predictions,
      stats,
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/tasks') {
    const limit = Number(url.searchParams.get('limit') || 20);
    const result = ctx.agent.taskOrchestrator?.listTasks(limit) || { ok: false, error: 'task_orchestrator_not_initialized' };
    return done(result.ok ? 200 : 500, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/tasks/status') {
    const taskId = String(url.searchParams.get('id') || '').trim();
    if (!taskId) return done(400, { ok: false, error: 'id is required' });
    const result = ctx.agent.taskOrchestrator?.getTask(taskId) || { ok: false, error: 'task_orchestrator_not_initialized' };
    return done(result.ok ? 200 : 404, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/tasks/run') {
    const body = await ctx.parseBody(req);
    const result = await ctx.agent.taskOrchestrator?.runTask(body || {}) || { ok: false, error: 'task_orchestrator_not_initialized' };
    return done(result.ok ? 200 : 400, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/workers') {
    const limit = Number(url.searchParams.get('limit') || 20);
    const result = ctx.agent.workerOrchestrator?.listWorkers(limit) || { ok: false, error: 'worker_orchestrator_not_initialized' };
    return done(result.ok ? 200 : 500, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/workers/start') {
    const body = await ctx.parseBody(req);
    const result = ctx.agent.workerOrchestrator?.startWorker(body || {}) || { ok: false, error: 'worker_orchestrator_not_initialized' };
    return done(result.ok ? 200 : 400, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/workers/stop') {
    const body = await ctx.parseBody(req);
    const result = ctx.agent.workerOrchestrator?.stopWorker(body?.id) || { ok: false, error: 'worker_orchestrator_not_initialized' };
    return done(result.ok ? 200 : 404, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/workers/tick') {
    const body = await ctx.parseBody(req);
    const result = await ctx.agent.workerOrchestrator?.tickWorker(body?.id) || { ok: false, error: 'worker_orchestrator_not_initialized' };
    return done(result.ok ? 200 : 404, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/controller/behaviors') {
    const limitRaw = Number(url.searchParams.get('limit') || 80);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 400)) : 80;
    return done(200, {
      ok: true,
      behaviors: ctx.agent.getControllerBehaviorSnapshot(limit)
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/controller/behavior-classes') {
    return done(200, {
      ok: true,
      classes: ctx.agent.getBehaviorClasses()
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/controller/behavior/reset') {
    const body = await ctx.parseBody(req);
    const providerRaw = String(body?.provider || '').trim();
    const provider = ctx.normalizeProviderId(providerRaw);
    const model = String(body?.model || '').trim().toLowerCase();
    if (!providerRaw || !model) return done(400, { error: 'provider and model are required' });
    const out = ctx.agent.resetControllerBehavior({ provider, model });
    return done(200, { ok: true, ...out });
  }

  if (req.method === 'POST' && url.pathname === '/api/controller/behavior/reset-all') {
    const out = ctx.agent.resetAllControllerBehaviors();
    return done(200, { ok: true, ...out });
  }

  if (req.method === 'POST' && url.pathname === '/api/controller/behavior/override') {
    const body = await ctx.parseBody(req);
    const providerRaw = String(body?.provider || '').trim();
    const provider = ctx.normalizeProviderId(providerRaw);
    const model = String(body?.model || '').trim().toLowerCase();
    const classId = String(body?.classId || '').trim();
    const tuning = body?.tuning && typeof body.tuning === 'object' ? body.tuning : {};
    const needs = body?.needs && typeof body.needs === 'object' ? body.needs : {};
    if (!providerRaw || !model || !classId) {
      return done(400, { error: 'provider, model, and classId are required' });
    }
    const key = ctx.behaviorOverrideKey(provider, model);
    ctx.config.model.behaviorOverrides = ctx.config.model.behaviorOverrides || {};
    ctx.config.model.behaviorOverrides[key] = { classId, tuning, needs };
    ctx.saveConfig(ctx.config);
    return done(200, {
      ok: true,
      key,
      override: ctx.config.model.behaviorOverrides[key]
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/controller/behavior/override/remove') {
    const body = await ctx.parseBody(req);
    const providerRaw = String(body?.provider || '').trim();
    const provider = ctx.normalizeProviderId(providerRaw);
    const model = String(body?.model || '').trim().toLowerCase();
    if (!providerRaw || !model) return done(400, { error: 'provider and model are required' });
    const key = ctx.behaviorOverrideKey(provider, model);
    ctx.config.model.behaviorOverrides = ctx.config.model.behaviorOverrides || {};
    const removed = Boolean(ctx.config.model.behaviorOverrides[key]);
    delete ctx.config.model.behaviorOverrides[key];
    ctx.saveConfig(ctx.config);
    return done(200, { ok: true, removed, key });
  }

  return false;
}
