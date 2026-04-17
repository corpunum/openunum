const PROVIDERS = ['ollama-local', 'ollama-cloud', 'openrouter', 'nvidia', 'xiaomimimo', 'openai'];

function toStr(v) {
  return String(v || '').trim();
}

function bool(v) {
  return Boolean(v);
}

function hasApiKey(config, provider) {
  const model = config?.model || {};
  if (provider === 'openrouter') return bool(toStr(model.openrouterApiKey));
  if (provider === 'nvidia') return bool(toStr(model.nvidiaApiKey));
  if (provider === 'xiaomimimo') return bool(toStr(model.xiaomimimoApiKey));
  if (provider === 'openai') return bool(toStr(model.openaiApiKey || model.genericApiKey));
  return true;
}

function providerBaseUrl(config, provider) {
  const model = config?.model || {};
  if (provider === 'ollama-local' || provider === 'ollama-cloud') return toStr(model.ollamaBaseUrl);
  if (provider === 'openrouter') return toStr(model.openrouterBaseUrl);
  if (provider === 'nvidia') return toStr(model.nvidiaBaseUrl);
  if (provider === 'xiaomimimo') return toStr(model.xiaomimimoBaseUrl);
  if (provider === 'openai') return toStr(model.openaiBaseUrl || model.genericBaseUrl);
  return '';
}

function inferSource(configValue, envValue) {
  if (toStr(configValue)) return 'config';
  if (toStr(envValue)) return 'env';
  return 'unset';
}

function pushIssue(target, level, code, message, details = {}) {
  target.push({ level, code, message, details });
}

export function evaluateFourBProfileReadiness(config = {}) {
  const issues = [];
  const compact = config?.runtime?.modelExecutionProfiles?.compact;

  if (!compact || typeof compact !== 'object') {
    pushIssue(issues, 'error', 'compact_profile_missing', 'runtime.modelExecutionProfiles.compact is required');
    return issues;
  }

  const maxHistory = Number(compact.maxHistoryMessages || 0);
  if (!Number.isFinite(maxHistory) || maxHistory <= 0) {
    pushIssue(issues, 'error', 'compact_history_invalid', 'compact.maxHistoryMessages must be a positive number', { value: compact.maxHistoryMessages });
  } else if (maxHistory > 260) {
    pushIssue(issues, 'warning', 'compact_history_high', 'compact.maxHistoryMessages is high for 4B-class models', { recommendedMax: 260, value: maxHistory });
  }

  const maxTools = Number(compact.maxToolIterations || 0);
  if (!Number.isFinite(maxTools) || maxTools <= 0) {
    pushIssue(issues, 'error', 'compact_tools_invalid', 'compact.maxToolIterations must be a positive number', { value: compact.maxToolIterations });
  } else if (maxTools > 3) {
    pushIssue(issues, 'warning', 'compact_tools_high', 'compact.maxToolIterations should be <= 3 for 4B-class reliability', { recommendedMax: 3, value: maxTools });
  }

  const compacting = config?.runtime?.contextCompactionEnabled;
  if (compacting !== true) {
    pushIssue(issues, 'warning', 'context_compaction_disabled', 'runtime.contextCompactionEnabled should be true for 4B-class profiles', { value: compacting });
  }

  return issues;
}

export function buildConfigParityReport(config = {}, env = process.env) {
  const issues = [];
  const model = config?.model || {};
  const runtime = config?.runtime || {};
  const activeProvider = toStr(model.provider || 'ollama-cloud').toLowerCase().replace(/^ollama$/, 'ollama-cloud');
  const disabledProviders = Array.isArray(model?.routing?.disabledProviders)
    ? model.routing.disabledProviders.map((p) => toStr(p).toLowerCase()).filter(Boolean)
    : [];
  const forcePrimaryProvider = model?.routing?.forcePrimaryProvider === true;
  const fallbackEnabled = model?.routing?.fallbackEnabled !== false;
  const fallbackProviders = Array.isArray(model?.routing?.fallbackProviders)
    ? model.routing.fallbackProviders.map((p) => toStr(p).toLowerCase()).filter(Boolean)
    : [];
  const effectiveFallbackProviders = fallbackEnabled
    ? fallbackProviders.filter((provider) => provider && !disabledProviders.includes(provider))
    : [];

  if (disabledProviders.includes(activeProvider)) {
    pushIssue(issues, 'error', 'active_provider_disabled', `Active provider ${activeProvider} is disabled in model.routing.disabledProviders`, {
      provider: activeProvider
    });
  }

  if (forcePrimaryProvider && disabledProviders.includes(activeProvider)) {
    pushIssue(issues, 'error', 'force_primary_disabled', `forcePrimaryProvider cannot be used when the active provider ${activeProvider} is disabled`, {
      provider: activeProvider
    });
  }

  if (!fallbackEnabled && fallbackProviders.length > 0) {
    pushIssue(issues, 'warning', 'fallback_chain_disabled', 'Fallback providers are configured but fallbackEnabled is false', {
      fallbackProviders
    });
  }

  if (!fallbackEnabled && disabledProviders.includes(activeProvider)) {
    pushIssue(issues, 'error', 'no_routable_primary_provider', 'Primary provider is disabled while fallback routing is disabled', {
      provider: activeProvider
    });
  }

  const providerMatrix = {};
  for (const provider of PROVIDERS) {
    const configBase = providerBaseUrl(config, provider);
    const envBase = env[`${provider.toUpperCase()}_BASE_URL`] || env.GENERIC_BASE_URL || '';
    const keyPresent = hasApiKey(config, provider);
    const basePresent = bool(configBase);

    providerMatrix[provider] = {
      baseUrlConfigured: basePresent,
      apiKeyConfigured: keyPresent,
      baseUrlSource: inferSource(configBase, envBase),
      requiredForProvider: provider === activeProvider || effectiveFallbackProviders.includes(provider),
      disabled: disabledProviders.includes(provider)
    };

    if ((provider === activeProvider || effectiveFallbackProviders.includes(provider)) && !basePresent) {
      pushIssue(issues, 'error', 'provider_base_url_missing', `Provider ${provider} is active/fallback but has no base URL configured`, { provider });
    }

    if ((provider === activeProvider || effectiveFallbackProviders.includes(provider)) && !provider.startsWith('ollama-') && !keyPresent) {
      pushIssue(issues, 'warning', 'provider_api_key_missing', `Provider ${provider} is active/fallback but API key is missing`, { provider });
    }
  }

  if (fallbackEnabled && (!Array.isArray(fallbackProviders) || fallbackProviders.length === 0)) {
    pushIssue(issues, 'warning', 'fallback_chain_empty', 'No fallback providers configured');
  }

  const providerModels = model.providerModels || {};
  for (const provider of [activeProvider, ...effectiveFallbackProviders]) {
    if (!toStr(providerModels[provider])) {
      pushIssue(issues, 'error', 'provider_model_missing', `providerModels.${provider} is required for active/fallback providers`, { provider });
    }
  }

  if (!toStr(runtime.workspaceRoot)) {
    pushIssue(issues, 'error', 'workspace_root_missing', 'runtime.workspaceRoot must be configured');
  }

  const fourBIssues = evaluateFourBProfileReadiness(config);
  issues.push(...fourBIssues);

  const hasErrors = issues.some((i) => i.level === 'error');
  const hasWarnings = issues.some((i) => i.level === 'warning');

  return {
    contractVersion: '2026-04-08.config-parity.v1',
    ok: !hasErrors,
    severity: hasErrors ? 'error' : (hasWarnings ? 'warning' : 'ok'),
    summary: {
      activeProvider,
      fallbackEnabled,
      fallbackProviders,
      effectiveFallbackProviders,
      disabledProviders,
      errorCount: issues.filter((i) => i.level === 'error').length,
      warningCount: issues.filter((i) => i.level === 'warning').length
    },
    providerMatrix,
    issues
  };
}
