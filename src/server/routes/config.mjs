export async function handleConfigRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    ctx.reloadConfigSecrets();
    ctx.normalizeModelSettings();
    const catalog = await ctx.buildModelCatalog(ctx.config.model);
    const sanitized = ctx.scrubSecretsFromConfig(ctx.config);
    ctx.sendJson(res, 200, {
      model: sanitized.model,
      runtime: sanitized.runtime,
      research: sanitized.research,
      integrations: sanitized.integrations,
      browser: sanitized.browser,
      channels: { telegram: { enabled: Boolean(ctx.config.channels?.telegram?.enabled), hasToken: Boolean(ctx.config.channels?.telegram?.botToken) } },
      capabilities: ctx.buildCapabilitiesPayload(),
      modelCatalog: catalog,
      providerConfig: ctx.getProviderConfigPayload(),
      authCatalog: await ctx.buildAuthCatalogPayload()
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/config') {
    const body = await ctx.parseBody(req);
    if (body.runtime && typeof body.runtime.shellEnabled === 'boolean') {
      ctx.config.runtime.shellEnabled = body.runtime.shellEnabled;
    }
    if (body.runtime && typeof body.runtime.workspaceRoot === 'string' && body.runtime.workspaceRoot.trim()) {
      ctx.config.runtime.workspaceRoot = body.runtime.workspaceRoot.trim();
    }
    if (body.runtime && typeof body.runtime.ownerControlMode === 'string' && body.runtime.ownerControlMode.trim()) {
      ctx.config.runtime.ownerControlMode = body.runtime.ownerControlMode.trim();
    }
    if (body.runtime && typeof body.runtime.selfPokeEnabled === 'boolean') {
      ctx.config.runtime.selfPokeEnabled = body.runtime.selfPokeEnabled;
    }
    if (body.runtime && typeof body.runtime.toolHooksEnabled === 'boolean') {
      ctx.config.runtime.toolHooksEnabled = body.runtime.toolHooksEnabled;
    }
    if (body.runtime && Number.isFinite(body.runtime.toolCircuitFailureThreshold)) {
      ctx.config.runtime.toolCircuitFailureThreshold = Number(body.runtime.toolCircuitFailureThreshold);
    }
    if (body.runtime && Number.isFinite(body.runtime.toolCircuitCooldownMs)) {
      ctx.config.runtime.toolCircuitCooldownMs = Number(body.runtime.toolCircuitCooldownMs);
    }
    if (body.runtime && typeof body.runtime.autonomyMasterAutoStart === 'boolean') {
      ctx.config.runtime.autonomyMasterAutoStart = body.runtime.autonomyMasterAutoStart;
    }
    if (body.runtime && typeof body.runtime.researchDailyEnabled === 'boolean') {
      ctx.config.runtime.researchDailyEnabled = body.runtime.researchDailyEnabled;
    }
    if (body.runtime && Number.isFinite(body.runtime.researchScheduleHour)) {
      ctx.config.runtime.researchScheduleHour = Number(body.runtime.researchScheduleHour);
    }
    if (body.runtime && typeof body.runtime.contextCompactionEnabled === 'boolean') {
      ctx.config.runtime.contextCompactionEnabled = body.runtime.contextCompactionEnabled;
    }
    if (body.runtime && Number.isFinite(body.runtime.contextCompactTriggerPct)) {
      ctx.config.runtime.contextCompactTriggerPct = Number(body.runtime.contextCompactTriggerPct);
    }
    if (body.runtime && Number.isFinite(body.runtime.contextCompactTargetPct)) {
      ctx.config.runtime.contextCompactTargetPct = Number(body.runtime.contextCompactTargetPct);
    }
    if (body.runtime && Number.isFinite(body.runtime.contextHardFailPct)) {
      ctx.config.runtime.contextHardFailPct = Number(body.runtime.contextHardFailPct);
    }
    if (body.runtime && Number.isFinite(body.runtime.contextProtectRecentTurns)) {
      ctx.config.runtime.contextProtectRecentTurns = Number(body.runtime.contextProtectRecentTurns);
    }
    if (body.runtime && Number.isFinite(body.runtime.contextFallbackTokens)) {
      ctx.config.runtime.contextFallbackTokens = Number(body.runtime.contextFallbackTokens);
    }
    if (body.runtime && Number.isFinite(body.runtime.maxToolIterations)) {
      ctx.config.runtime.maxToolIterations = Number(body.runtime.maxToolIterations);
    }
    if (body.runtime && Number.isFinite(body.runtime.executorRetryAttempts)) {
      ctx.config.runtime.executorRetryAttempts = Number(body.runtime.executorRetryAttempts);
    }
    if (body.runtime && Number.isFinite(body.runtime.executorRetryBackoffMs)) {
      ctx.config.runtime.executorRetryBackoffMs = Number(body.runtime.executorRetryBackoffMs);
    }
    if (body.runtime && typeof body.runtime.autonomyMode === 'string') {
      ctx.config.runtime.autonomyMode = body.runtime.autonomyMode;
    }
    if (body.runtime && typeof body.runtime.missionDefaultContinueUntilDone === 'boolean') {
      ctx.config.runtime.missionDefaultContinueUntilDone = body.runtime.missionDefaultContinueUntilDone;
    }
    if (body.runtime && Number.isFinite(body.runtime.missionDefaultHardStepCap)) {
      ctx.config.runtime.missionDefaultHardStepCap = Number(body.runtime.missionDefaultHardStepCap);
    }
    if (body.runtime && Number.isFinite(body.runtime.missionDefaultMaxRetries)) {
      ctx.config.runtime.missionDefaultMaxRetries = Number(body.runtime.missionDefaultMaxRetries);
    }
    if (body.runtime && Number.isFinite(body.runtime.missionDefaultIntervalMs)) {
      ctx.config.runtime.missionDefaultIntervalMs = Number(body.runtime.missionDefaultIntervalMs);
    }
    if (body.runtime && typeof body.runtime.enforceModelExecutionProfiles === 'boolean') {
      ctx.config.runtime.enforceModelExecutionProfiles = body.runtime.enforceModelExecutionProfiles;
    }
    if (body.runtime && body.runtime.modelExecutionProfiles && typeof body.runtime.modelExecutionProfiles === 'object') {
      const nextProfiles = {};
      for (const tier of ['compact', 'balanced', 'full']) {
        const source = body.runtime.modelExecutionProfiles?.[tier];
        if (!source || typeof source !== 'object') continue;
        const out = {};
        if (Number.isFinite(source.maxHistoryMessages)) out.maxHistoryMessages = Number(source.maxHistoryMessages);
        if (Number.isFinite(source.maxToolIterations)) out.maxToolIterations = Number(source.maxToolIterations);
        if (Array.isArray(source.allowedTools)) {
          out.allowedTools = source.allowedTools.map((tool) => String(tool || '').trim()).filter(Boolean);
        }
        nextProfiles[tier] = out;
      }
      ctx.config.runtime.modelExecutionProfiles = {
        ...(ctx.config.runtime.modelExecutionProfiles || {}),
        ...nextProfiles
      };
    }
    if (body.runtime && body.runtime.autonomyPolicy && typeof body.runtime.autonomyPolicy === 'object') {
      const nextPolicy = { ...(ctx.config.runtime.autonomyPolicy || {}) };
      if (typeof body.runtime.autonomyPolicy.enabled === 'boolean') nextPolicy.enabled = body.runtime.autonomyPolicy.enabled;
      if (typeof body.runtime.autonomyPolicy.mode === 'string') nextPolicy.mode = body.runtime.autonomyPolicy.mode.trim().toLowerCase() === 'plan' ? 'plan' : 'execute';
      if (typeof body.runtime.autonomyPolicy.enforceSelfProtection === 'boolean') nextPolicy.enforceSelfProtection = body.runtime.autonomyPolicy.enforceSelfProtection;
      if (typeof body.runtime.autonomyPolicy.blockShellSelfDestruct === 'boolean') nextPolicy.blockShellSelfDestruct = body.runtime.autonomyPolicy.blockShellSelfDestruct;
      if (typeof body.runtime.autonomyPolicy.denyMutatingToolsInPlan === 'boolean') nextPolicy.denyMutatingToolsInPlan = body.runtime.autonomyPolicy.denyMutatingToolsInPlan;
      if (typeof body.runtime.autonomyPolicy.allowRecoveryToolsInPlan === 'boolean') nextPolicy.allowRecoveryToolsInPlan = body.runtime.autonomyPolicy.allowRecoveryToolsInPlan;
      ctx.config.runtime.autonomyPolicy = nextPolicy;
    }
    if (body.model && typeof body.model.provider === 'string' && body.model.provider.trim()) {
      ctx.config.model.provider = ctx.normalizeProviderId(body.model.provider.trim());
    }
    if (body.model && typeof body.model.model === 'string' && body.model.model.trim()) {
      ctx.config.model.model = body.model.model.trim().replace(/^generic\//, 'openai/');
      ctx.config.model.providerModels = ctx.config.model.providerModels || {};
      ctx.config.model.providerModels[ctx.config.model.provider] = ctx.config.model.model;
    }
    if (body.model && body.model.providerModels && typeof body.model.providerModels === 'object') {
      ctx.config.model.providerModels = ctx.config.model.providerModels || {};
      for (const [provider, model] of Object.entries(body.model.providerModels)) {
        const normalizedProvider = ctx.normalizeProviderId(provider);
        if (typeof model === 'string' && model.trim()) {
          ctx.config.model.providerModels[normalizedProvider] = model.trim().replace(/^generic\//, 'openai/');
        }
      }
    }
    if (body.model && body.model.routing) {
      ctx.config.model.routing = { ...ctx.config.model.routing, ...body.model.routing };
      if (Array.isArray(body.model.routing.fallbackProviders)) {
        ctx.config.model.routing.fallbackProviders = body.model.routing.fallbackProviders.map((provider) => ctx.normalizeProviderId(provider));
      }
    }
    if (body.integrations?.googleWorkspace && typeof body.integrations.googleWorkspace.cliCommand === 'string') {
      ctx.config.integrations.googleWorkspace.cliCommand = body.integrations.googleWorkspace.cliCommand.trim() || 'gws';
    }
    ctx.normalizeModelSettings();
    ctx.saveConfig(ctx.config);
    ctx.agent.reloadTools();
    if (ctx.config.runtime.researchDailyEnabled) ctx.startResearchDailyLoop();
    else ctx.stopResearchDailyLoop();
    ctx.sendJson(res, 200, { ok: true, runtime: ctx.config.runtime });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/providers/config') {
    ctx.reloadConfigSecrets();
    ctx.normalizeModelSettings();
    ctx.sendJson(res, 200, ctx.getProviderConfigPayload());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/providers/config') {
    const body = await ctx.parseBody(req);
    const up = body || {};
    if (typeof up.ollamaBaseUrl === 'string') ctx.config.model.ollamaBaseUrl = up.ollamaBaseUrl.trim();
    if (typeof up.openrouterBaseUrl === 'string') ctx.config.model.openrouterBaseUrl = up.openrouterBaseUrl.trim();
    if (typeof up.nvidiaBaseUrl === 'string') ctx.config.model.nvidiaBaseUrl = up.nvidiaBaseUrl.trim();
    if (typeof up.openaiBaseUrl === 'string') ctx.config.model.openaiBaseUrl = up.openaiBaseUrl.trim();
    if (typeof up.genericBaseUrl === 'string') ctx.config.model.openaiBaseUrl = up.genericBaseUrl.trim();
    const secretUpdates = {};
    if (typeof up.openrouterApiKey === 'string') secretUpdates.openrouterApiKey = up.openrouterApiKey.trim();
    if (typeof up.nvidiaApiKey === 'string') secretUpdates.nvidiaApiKey = up.nvidiaApiKey.trim();
    if (typeof up.openaiApiKey === 'string') secretUpdates.openaiApiKey = up.openaiApiKey.trim();
    if (typeof up.genericApiKey === 'string') secretUpdates.openaiApiKey = up.genericApiKey.trim();
    ctx.persistSecretUpdates(secretUpdates);
    ctx.normalizeModelSettings();
    ctx.saveConfig(ctx.config);
    ctx.agent.reloadTools();
    ctx.sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/providers/import-openclaw') {
    const imported = ctx.importProviderSecretsFromOpenClaw();
    ctx.persistSecretUpdates({
      openrouterApiKey: imported.openrouterApiKey || '',
      nvidiaApiKey: imported.nvidiaApiKey || '',
      openaiApiKey: imported.openaiApiKey || '',
      githubToken: imported.githubToken || '',
      huggingfaceApiKey: imported.huggingfaceApiKey || '',
      elevenlabsApiKey: imported.elevenlabsApiKey || '',
      telegramBotToken: imported.telegramBotToken || ''
    });
    if (imported.openrouterBaseUrl) ctx.config.model.openrouterBaseUrl = imported.openrouterBaseUrl;
    if (imported.nvidiaBaseUrl) ctx.config.model.nvidiaBaseUrl = imported.nvidiaBaseUrl;
    if (imported.openaiBaseUrl) ctx.config.model.openaiBaseUrl = imported.openaiBaseUrl;
    if (imported.ollamaBaseUrl) ctx.config.model.ollamaBaseUrl = imported.ollamaBaseUrl;
    ctx.normalizeModelSettings();
    ctx.saveConfig(ctx.config);
    ctx.agent.reloadTools();
    ctx.sendJson(res, 200, {
      ok: true,
      imported: {
        openrouterApiKey: Boolean(imported.openrouterApiKey),
        nvidiaApiKey: Boolean(imported.nvidiaApiKey),
        openaiApiKey: Boolean(imported.openaiApiKey),
        githubToken: Boolean(imported.githubToken),
        huggingfaceApiKey: Boolean(imported.huggingfaceApiKey),
        elevenlabsApiKey: Boolean(imported.elevenlabsApiKey),
        telegramBotToken: Boolean(imported.telegramBotToken),
        openrouterBaseUrl: imported.openrouterBaseUrl || ctx.config.model.openrouterBaseUrl,
        nvidiaBaseUrl: imported.nvidiaBaseUrl || ctx.config.model.nvidiaBaseUrl,
        openaiBaseUrl: imported.openaiBaseUrl || ctx.config.model.openaiBaseUrl,
        ollamaBaseUrl: imported.ollamaBaseUrl || ctx.config.model.ollamaBaseUrl
      }
    });
    return true;
  }

  return false;
}
