import { normalizeProviderId } from '../../models/catalog.mjs';
import { normalizeModelConfig } from '../../config.mjs';
import { applySecretsToConfig, loadSecretStore, mergeSecrets, saveSecretStore } from '../../secrets/store.mjs';

export function createConfigService({ config, PROVIDER_ORDER, reloadConfigSecrets }) {
  function normalizeModelSettings() {
    config.model = normalizeModelConfig(config.model || {});
    config.model.genericBaseUrl = config.model.openaiBaseUrl;
    config.model.genericApiKey = config.model.openaiApiKey;
    config.model.routing = config.model.routing || {};
    config.model.behaviorOverrides = config.model.behaviorOverrides || {};
  }

  function behaviorOverrideKey(provider, model) {
    const p = normalizeProviderId(provider || 'ollama-cloud');
    const m = String(model || '').trim().toLowerCase();
    return `${p}::${m}`;
  }

  function getProviderConfigPayload() {
    return {
      ollamaBaseUrl: config.model.ollamaBaseUrl,
      ollamaCloudBaseUrl: config.model.ollamaCloudBaseUrl || config.model.ollamaBaseUrl || 'http://127.0.0.1:11434',
      ollamaLocalBaseUrl: config.model.ollamaLocalBaseUrl || config.model.ollamaBaseUrl || 'http://127.0.0.1:11434',
      openrouterBaseUrl: config.model.openrouterBaseUrl,
      nvidiaBaseUrl: config.model.nvidiaBaseUrl,
      xiaomimimoBaseUrl: config.model.xiaomimimoBaseUrl,
      openaiBaseUrl: config.model.openaiBaseUrl || config.model.genericBaseUrl,
      genericBaseUrl: config.model.openaiBaseUrl || config.model.genericBaseUrl,
      hasOpenrouterApiKey: Boolean(config.model.openrouterApiKey),
      hasNvidiaApiKey: Boolean(config.model.nvidiaApiKey),
      hasXiaomimimoApiKey: Boolean(config.model.xiaomimimoApiKey),
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

  function applyConfigPatch(body = {}, { normalizeProviderId: normalizeProvider = normalizeProviderId } = {}) {
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
    if (body.runtime && typeof body.runtime.toolHooksEnabled === 'boolean') {
      config.runtime.toolHooksEnabled = body.runtime.toolHooksEnabled;
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
    if (body.runtime && Number.isFinite(body.runtime.maxRequestBodyBytes)) {
      config.runtime.maxRequestBodyBytes = Number(body.runtime.maxRequestBodyBytes);
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
    if (body.runtime && typeof body.runtime.enforceModelExecutionProfiles === 'boolean') {
      config.runtime.enforceModelExecutionProfiles = body.runtime.enforceModelExecutionProfiles;
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
      config.runtime.modelExecutionProfiles = {
        ...(config.runtime.modelExecutionProfiles || {}),
        ...nextProfiles
      };
    }
    if (body.runtime && body.runtime.autonomyPolicy && typeof body.runtime.autonomyPolicy === 'object') {
      const nextPolicy = { ...(config.runtime.autonomyPolicy || {}) };
      if (typeof body.runtime.autonomyPolicy.enabled === 'boolean') nextPolicy.enabled = body.runtime.autonomyPolicy.enabled;
      if (typeof body.runtime.autonomyPolicy.mode === 'string') nextPolicy.mode = body.runtime.autonomyPolicy.mode.trim().toLowerCase() === 'plan' ? 'plan' : 'execute';
      if (typeof body.runtime.autonomyPolicy.enforceSelfProtection === 'boolean') nextPolicy.enforceSelfProtection = body.runtime.autonomyPolicy.enforceSelfProtection;
      if (typeof body.runtime.autonomyPolicy.blockShellSelfDestruct === 'boolean') nextPolicy.blockShellSelfDestruct = body.runtime.autonomyPolicy.blockShellSelfDestruct;
      if (typeof body.runtime.autonomyPolicy.denyMutatingToolsInPlan === 'boolean') nextPolicy.denyMutatingToolsInPlan = body.runtime.autonomyPolicy.denyMutatingToolsInPlan;
      if (typeof body.runtime.autonomyPolicy.allowRecoveryToolsInPlan === 'boolean') nextPolicy.allowRecoveryToolsInPlan = body.runtime.autonomyPolicy.allowRecoveryToolsInPlan;
      config.runtime.autonomyPolicy = nextPolicy;
    }
    if (body.runtime && body.runtime.modelBackedTools && typeof body.runtime.modelBackedTools === 'object') {
      const source = body.runtime.modelBackedTools;
      const next = { ...(config.runtime.modelBackedTools || {}) };
      if (typeof source.enabled === 'boolean') next.enabled = source.enabled;
      if (typeof source.exposeToController === 'boolean') next.exposeToController = source.exposeToController;
      if (Number.isFinite(source.localMaxConcurrency)) next.localMaxConcurrency = Number(source.localMaxConcurrency);
      if (Number.isFinite(source.queueDepth)) next.queueDepth = Number(source.queueDepth);
      if (typeof source.autoProfileTuningEnabled === 'boolean') next.autoProfileTuningEnabled = source.autoProfileTuningEnabled;
      if (Number.isFinite(source.profileSwitchMinSamples)) next.profileSwitchMinSamples = Number(source.profileSwitchMinSamples);
      if (Number.isFinite(source.latencyWeight)) next.latencyWeight = Number(source.latencyWeight);
      if (Number.isFinite(source.costWeight)) next.costWeight = Number(source.costWeight);
      if (Number.isFinite(source.failurePenalty)) next.failurePenalty = Number(source.failurePenalty);
      if (source.tools && typeof source.tools === 'object') {
        const nextTools = { ...(next.tools || {}) };
        for (const [toolName, toolCfg] of Object.entries(source.tools)) {
          if (!toolCfg || typeof toolCfg !== 'object') continue;
          const row = { ...(nextTools[toolName] || {}) };
          if (Array.isArray(toolCfg.backendProfiles)) {
            row.backendProfiles = toolCfg.backendProfiles
              .filter((item) => item && typeof item === 'object')
              .map((item) => ({
                id: String(item.id || '').trim(),
                type: String(item.type || 'model').trim(),
                provider: String(item.provider || '').trim(),
                model: String(item.model || '').trim(),
                timeoutMs: Number.isFinite(item.timeoutMs) ? Number(item.timeoutMs) : undefined
              }))
              .filter((item) => item.id && item.provider && item.model);
          }
          nextTools[toolName] = row;
        }
        next.tools = nextTools;
      }
      if (Array.isArray(source.recommendedLocalModels)) {
        next.recommendedLocalModels = source.recommendedLocalModels
          .map((item) => String(item || '').trim())
          .filter(Boolean);
      }
      config.runtime.modelBackedTools = next;
    }

    if (body.model && typeof body.model.provider === 'string' && body.model.provider.trim()) {
      config.model.provider = normalizeProvider(body.model.provider.trim());
    }
    if (body.model && typeof body.model.model === 'string' && body.model.model.trim()) {
      config.model.model = body.model.model.trim().replace(/^generic\//, 'openai/');
      config.model.providerModels = config.model.providerModels || {};
      config.model.providerModels[config.model.provider] = config.model.model;
    }
    if (body.model && body.model.providerModels && typeof body.model.providerModels === 'object') {
      config.model.providerModels = config.model.providerModels || {};
      for (const [provider, model] of Object.entries(body.model.providerModels)) {
        const normalizedProvider = normalizeProvider(provider);
        if (typeof model === 'string' && model.trim()) {
          config.model.providerModels[normalizedProvider] = model.trim().replace(/^generic\//, 'openai/');
        }
      }
    }
    if (body.model && body.model.routing) {
      config.model.routing = { ...config.model.routing, ...body.model.routing };
      if (Array.isArray(body.model.routing.fallbackProviders)) {
        config.model.routing.fallbackProviders = body.model.routing.fallbackProviders.map((provider) => normalizeProvider(provider));
      }
    }
    if (body.integrations?.googleWorkspace && typeof body.integrations.googleWorkspace.cliCommand === 'string') {
      config.integrations.googleWorkspace.cliCommand = body.integrations.googleWorkspace.cliCommand.trim() || 'gws';
    }
  }

  function applyProvidersConfigPatch(body = {}) {
    if (typeof body.ollamaBaseUrl === 'string') config.model.ollamaBaseUrl = body.ollamaBaseUrl.trim();
    if (typeof body.ollamaCloudBaseUrl === 'string') config.model.ollamaCloudBaseUrl = body.ollamaCloudBaseUrl.trim();
    if (typeof body.ollamaLocalBaseUrl === 'string') config.model.ollamaLocalBaseUrl = body.ollamaLocalBaseUrl.trim();
    if (typeof body.openrouterBaseUrl === 'string') config.model.openrouterBaseUrl = body.openrouterBaseUrl.trim();
    if (typeof body.nvidiaBaseUrl === 'string') config.model.nvidiaBaseUrl = body.nvidiaBaseUrl.trim();
    if (typeof body.xiaomimimoBaseUrl === 'string') config.model.xiaomimimoBaseUrl = body.xiaomimimoBaseUrl.trim();
    if (typeof body.openaiBaseUrl === 'string') config.model.openaiBaseUrl = body.openaiBaseUrl.trim();
    if (typeof body.genericBaseUrl === 'string') config.model.openaiBaseUrl = body.genericBaseUrl.trim();

    const secretUpdates = {};
    if (typeof body.openrouterApiKey === 'string') secretUpdates.openrouterApiKey = body.openrouterApiKey.trim();
    if (typeof body.nvidiaApiKey === 'string') secretUpdates.nvidiaApiKey = body.nvidiaApiKey.trim();
    if (typeof body.xiaomimimoApiKey === 'string') secretUpdates.xiaomimimoApiKey = body.xiaomimimoApiKey.trim();
    if (typeof body.openaiApiKey === 'string') secretUpdates.openaiApiKey = body.openaiApiKey.trim();
    if (typeof body.genericApiKey === 'string') secretUpdates.openaiApiKey = body.genericApiKey.trim();
    persistSecretUpdates(secretUpdates);
  }

  return {
    normalizeModelSettings,
    behaviorOverrideKey,
    getProviderConfigPayload,
    persistSecretUpdates,
    applyConfigPatch,
    applyProvidersConfigPatch
  };
}
