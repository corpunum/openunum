function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function inRange(value, min, max) {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function addTypeError(errors, field, expected) {
  errors.push({ field, issue: `expected ${expected}` });
}

function validateUrlField(errors, field, value) {
  if (typeof value !== 'string') {
    addTypeError(errors, field, 'string');
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) return;
  if (!/^https?:\/\//i.test(trimmed)) {
    errors.push({ field, issue: 'expected http(s) URL' });
  }
}

function validateConfigPayload(body, ctx) {
  const errors = [];
  if (!isPlainObject(body)) {
    return [{ field: 'body', issue: 'expected JSON object' }];
  }

  const allowedTopLevel = new Set(['runtime', 'model', 'integrations']);
  for (const key of Object.keys(body)) {
    if (!allowedTopLevel.has(key)) errors.push({ field: key, issue: 'unknown top-level key' });
  }

  const runtime = body.runtime;
  if (runtime !== undefined) {
    if (!isPlainObject(runtime)) {
      addTypeError(errors, 'runtime', 'object');
    } else {
      const boolFields = [
        'shellEnabled', 'selfPokeEnabled', 'toolHooksEnabled', 'autonomyMasterAutoStart',
        'researchDailyEnabled', 'contextCompactionEnabled', 'missionDefaultContinueUntilDone',
        'enforceModelExecutionProfiles'
      ];
      for (const field of boolFields) {
        if (runtime[field] !== undefined && typeof runtime[field] !== 'boolean') {
          addTypeError(errors, `runtime.${field}`, 'boolean');
        }
      }
      if (runtime.workspaceRoot !== undefined && typeof runtime.workspaceRoot !== 'string') addTypeError(errors, 'runtime.workspaceRoot', 'string');
      if (runtime.ownerControlMode !== undefined && typeof runtime.ownerControlMode !== 'string') addTypeError(errors, 'runtime.ownerControlMode', 'string');
      if (runtime.autonomyMode !== undefined && typeof runtime.autonomyMode !== 'string') addTypeError(errors, 'runtime.autonomyMode', 'string');

      if (runtime.toolCircuitFailureThreshold !== undefined && !inRange(runtime.toolCircuitFailureThreshold, 1, 100)) addTypeError(errors, 'runtime.toolCircuitFailureThreshold', 'number in [1,100]');
      if (runtime.toolCircuitCooldownMs !== undefined && !inRange(runtime.toolCircuitCooldownMs, 1000, 3600000)) addTypeError(errors, 'runtime.toolCircuitCooldownMs', 'number in [1000,3600000]');
      if (runtime.researchScheduleHour !== undefined && !inRange(runtime.researchScheduleHour, 0, 23)) addTypeError(errors, 'runtime.researchScheduleHour', 'number in [0,23]');
      if (runtime.contextCompactTriggerPct !== undefined && !inRange(runtime.contextCompactTriggerPct, 0.05, 0.99)) addTypeError(errors, 'runtime.contextCompactTriggerPct', 'number in [0.05,0.99]');
      if (runtime.contextCompactTargetPct !== undefined && !inRange(runtime.contextCompactTargetPct, 0.05, 0.95)) addTypeError(errors, 'runtime.contextCompactTargetPct', 'number in [0.05,0.95]');
      if (runtime.contextHardFailPct !== undefined && !inRange(runtime.contextHardFailPct, 0.1, 0.999)) addTypeError(errors, 'runtime.contextHardFailPct', 'number in [0.1,0.999]');
      if (runtime.contextProtectRecentTurns !== undefined && !inRange(runtime.contextProtectRecentTurns, 0, 1000)) addTypeError(errors, 'runtime.contextProtectRecentTurns', 'number in [0,1000]');
      if (runtime.contextFallbackTokens !== undefined && !inRange(runtime.contextFallbackTokens, 256, 2000000)) addTypeError(errors, 'runtime.contextFallbackTokens', 'number in [256,2000000]');
      if (runtime.maxToolIterations !== undefined && !inRange(runtime.maxToolIterations, 1, 100)) addTypeError(errors, 'runtime.maxToolIterations', 'number in [1,100]');
      if (runtime.executorRetryAttempts !== undefined && !inRange(runtime.executorRetryAttempts, 0, 20)) addTypeError(errors, 'runtime.executorRetryAttempts', 'number in [0,20]');
      if (runtime.executorRetryBackoffMs !== undefined && !inRange(runtime.executorRetryBackoffMs, 0, 120000)) addTypeError(errors, 'runtime.executorRetryBackoffMs', 'number in [0,120000]');
      if (runtime.maxRequestBodyBytes !== undefined && !inRange(runtime.maxRequestBodyBytes, 1024, 10485760)) addTypeError(errors, 'runtime.maxRequestBodyBytes', 'number in [1024,10485760]');
      if (runtime.missionDefaultHardStepCap !== undefined && !inRange(runtime.missionDefaultHardStepCap, 1, 10000)) addTypeError(errors, 'runtime.missionDefaultHardStepCap', 'number in [1,10000]');
      if (runtime.missionDefaultMaxRetries !== undefined && !inRange(runtime.missionDefaultMaxRetries, 0, 50)) addTypeError(errors, 'runtime.missionDefaultMaxRetries', 'number in [0,50]');
      if (runtime.missionDefaultIntervalMs !== undefined && !inRange(runtime.missionDefaultIntervalMs, 10, 60000)) addTypeError(errors, 'runtime.missionDefaultIntervalMs', 'number in [10,60000]');

      if (runtime.autonomyPolicy !== undefined) {
        if (!isPlainObject(runtime.autonomyPolicy)) {
          addTypeError(errors, 'runtime.autonomyPolicy', 'object');
        } else {
          const ap = runtime.autonomyPolicy;
          for (const key of ['enabled', 'enforceSelfProtection', 'blockShellSelfDestruct', 'denyMutatingToolsInPlan', 'allowRecoveryToolsInPlan']) {
            if (ap[key] !== undefined && typeof ap[key] !== 'boolean') addTypeError(errors, `runtime.autonomyPolicy.${key}`, 'boolean');
          }
          if (ap.mode !== undefined && !['plan', 'execute'].includes(String(ap.mode).trim().toLowerCase())) {
            errors.push({ field: 'runtime.autonomyPolicy.mode', issue: 'expected "plan" or "execute"' });
          }
        }
      }

      if (runtime.modelExecutionProfiles !== undefined) {
        if (!isPlainObject(runtime.modelExecutionProfiles)) {
          addTypeError(errors, 'runtime.modelExecutionProfiles', 'object');
        } else {
          for (const [tier, profile] of Object.entries(runtime.modelExecutionProfiles)) {
            if (!['compact', 'balanced', 'full'].includes(tier)) {
              errors.push({ field: `runtime.modelExecutionProfiles.${tier}`, issue: 'unknown tier key' });
              continue;
            }
            if (!isPlainObject(profile)) {
              addTypeError(errors, `runtime.modelExecutionProfiles.${tier}`, 'object');
              continue;
            }
            if (profile.maxHistoryMessages !== undefined && !inRange(profile.maxHistoryMessages, 1, 20000)) addTypeError(errors, `runtime.modelExecutionProfiles.${tier}.maxHistoryMessages`, 'number in [1,20000]');
            if (profile.maxToolIterations !== undefined && !inRange(profile.maxToolIterations, 1, 100)) addTypeError(errors, `runtime.modelExecutionProfiles.${tier}.maxToolIterations`, 'number in [1,100]');
            if (profile.allowedTools !== undefined && (!Array.isArray(profile.allowedTools) || !profile.allowedTools.every((x) => typeof x === 'string'))) {
              addTypeError(errors, `runtime.modelExecutionProfiles.${tier}.allowedTools`, 'string[]');
            }
          }
        }
      }
    }
  }

  const model = body.model;
  if (model !== undefined) {
    if (!isPlainObject(model)) {
      addTypeError(errors, 'model', 'object');
    } else {
      if (model.provider !== undefined && typeof model.provider !== 'string') addTypeError(errors, 'model.provider', 'string');
      if (model.model !== undefined && typeof model.model !== 'string') addTypeError(errors, 'model.model', 'string');
      if (model.provider !== undefined) {
        const normalized = ctx.normalizeProviderId(model.provider);
        const allowedProviders = new Set(['ollama-local', 'ollama-cloud', 'nvidia', 'openrouter', 'xiaomimimo', 'openai']);
        if (!allowedProviders.has(normalized)) errors.push({ field: 'model.provider', issue: 'unknown provider' });
      }
      if (model.providerModels !== undefined) {
        if (!isPlainObject(model.providerModels)) {
          addTypeError(errors, 'model.providerModels', 'object');
        } else {
          for (const [provider, value] of Object.entries(model.providerModels)) {
            if (typeof value !== 'string') addTypeError(errors, `model.providerModels.${provider}`, 'string');
          }
        }
      }
      if (model.routing !== undefined) {
        if (!isPlainObject(model.routing)) {
          addTypeError(errors, 'model.routing', 'object');
        } else {
          if (model.routing.fallbackEnabled !== undefined && typeof model.routing.fallbackEnabled !== 'boolean') addTypeError(errors, 'model.routing.fallbackEnabled', 'boolean');
          if (model.routing.forcePrimaryProvider !== undefined && typeof model.routing.forcePrimaryProvider !== 'boolean') addTypeError(errors, 'model.routing.forcePrimaryProvider', 'boolean');
          if (model.routing.fallbackProviders !== undefined) {
            if (!Array.isArray(model.routing.fallbackProviders) || !model.routing.fallbackProviders.every((item) => typeof item === 'string')) {
              addTypeError(errors, 'model.routing.fallbackProviders', 'string[]');
            }
          }
        }
      }
    }
  }

  const integrations = body.integrations;
  if (integrations !== undefined) {
    if (!isPlainObject(integrations)) {
      addTypeError(errors, 'integrations', 'object');
    } else if (integrations.googleWorkspace !== undefined) {
      if (!isPlainObject(integrations.googleWorkspace)) {
        addTypeError(errors, 'integrations.googleWorkspace', 'object');
      } else if (integrations.googleWorkspace.cliCommand !== undefined && typeof integrations.googleWorkspace.cliCommand !== 'string') {
        addTypeError(errors, 'integrations.googleWorkspace.cliCommand', 'string');
      }
    }
  }

  return errors;
}

function validateProvidersConfigPayload(body) {
  const errors = [];
  if (!isPlainObject(body)) return [{ field: 'body', issue: 'expected JSON object' }];
  const allowed = new Set([
    'ollamaBaseUrl', 'openrouterBaseUrl', 'nvidiaBaseUrl', 'xiaomimimoBaseUrl', 'openaiBaseUrl', 'genericBaseUrl',
    'openrouterApiKey', 'nvidiaApiKey', 'xiaomimimoApiKey', 'openaiApiKey', 'genericApiKey'
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.push({ field: key, issue: 'unknown key' });
  }
  for (const key of ['ollamaBaseUrl', 'openrouterBaseUrl', 'nvidiaBaseUrl', 'xiaomimimoBaseUrl', 'openaiBaseUrl', 'genericBaseUrl']) {
    if (body[key] !== undefined) validateUrlField(errors, key, body[key]);
  }
  for (const key of ['openrouterApiKey', 'nvidiaApiKey', 'xiaomimimoApiKey', 'openaiApiKey', 'genericApiKey']) {
    if (body[key] !== undefined && typeof body[key] !== 'string') addTypeError(errors, key, 'string');
  }
  return errors;
}

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
    const validationErrors = validateConfigPayload(body, ctx);
    if (validationErrors.length > 0) {
      ctx.sendJson(res, 400, {
        ok: false,
        error: 'invalid_payload',
        details: validationErrors
      });
      return true;
    }
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
    if (body.runtime && Number.isFinite(body.runtime.maxRequestBodyBytes)) {
      ctx.config.runtime.maxRequestBodyBytes = Number(body.runtime.maxRequestBodyBytes);
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
    const validationErrors = validateProvidersConfigPayload(body);
    if (validationErrors.length > 0) {
      ctx.sendJson(res, 400, {
        ok: false,
        error: 'invalid_payload',
        details: validationErrors
      });
      return true;
    }
    const up = body || {};
    if (typeof up.ollamaBaseUrl === 'string') ctx.config.model.ollamaBaseUrl = up.ollamaBaseUrl.trim();
    if (typeof up.openrouterBaseUrl === 'string') ctx.config.model.openrouterBaseUrl = up.openrouterBaseUrl.trim();
    if (typeof up.nvidiaBaseUrl === 'string') ctx.config.model.nvidiaBaseUrl = up.nvidiaBaseUrl.trim();
    if (typeof up.xiaomimimoBaseUrl === 'string') ctx.config.model.xiaomimimoBaseUrl = up.xiaomimimoBaseUrl.trim();
    if (typeof up.openaiBaseUrl === 'string') ctx.config.model.openaiBaseUrl = up.openaiBaseUrl.trim();
    if (typeof up.genericBaseUrl === 'string') ctx.config.model.openaiBaseUrl = up.genericBaseUrl.trim();
    const secretUpdates = {};
    if (typeof up.openrouterApiKey === 'string') secretUpdates.openrouterApiKey = up.openrouterApiKey.trim();
    if (typeof up.nvidiaApiKey === 'string') secretUpdates.nvidiaApiKey = up.nvidiaApiKey.trim();
    if (typeof up.xiaomimimoApiKey === 'string') secretUpdates.xiaomimimoApiKey = up.xiaomimimoApiKey.trim();
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
      xiaomimimoApiKey: imported.xiaomimimoApiKey || '',
      openaiApiKey: imported.openaiApiKey || '',
      githubToken: imported.githubToken || '',
      huggingfaceApiKey: imported.huggingfaceApiKey || '',
      elevenlabsApiKey: imported.elevenlabsApiKey || '',
      telegramBotToken: imported.telegramBotToken || ''
    });
    if (imported.openrouterBaseUrl) ctx.config.model.openrouterBaseUrl = imported.openrouterBaseUrl;
    if (imported.nvidiaBaseUrl) ctx.config.model.nvidiaBaseUrl = imported.nvidiaBaseUrl;
    if (imported.xiaomimimoBaseUrl) ctx.config.model.xiaomimimoBaseUrl = imported.xiaomimimoBaseUrl;
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
        xiaomimimoApiKey: Boolean(imported.xiaomimimoApiKey),
        openaiApiKey: Boolean(imported.openaiApiKey),
        githubToken: Boolean(imported.githubToken),
        huggingfaceApiKey: Boolean(imported.huggingfaceApiKey),
        elevenlabsApiKey: Boolean(imported.elevenlabsApiKey),
        telegramBotToken: Boolean(imported.telegramBotToken),
        openrouterBaseUrl: imported.openrouterBaseUrl || ctx.config.model.openrouterBaseUrl,
        nvidiaBaseUrl: imported.nvidiaBaseUrl || ctx.config.model.nvidiaBaseUrl,
        xiaomimimoBaseUrl: imported.xiaomimimoBaseUrl || ctx.config.model.xiaomimimoBaseUrl,
        openaiBaseUrl: imported.openaiBaseUrl || ctx.config.model.openaiBaseUrl,
        ollamaBaseUrl: imported.ollamaBaseUrl || ctx.config.model.ollamaBaseUrl
      }
    });
    return true;
  }

  return false;
}
