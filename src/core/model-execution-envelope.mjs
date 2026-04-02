function inferParamsB(modelId) {
  const text = String(modelId || '').toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)b/);
  return match ? Number(match[1]) : null;
}

function inferTier(provider, modelId) {
  const providerId = String(provider || '').toLowerCase();
  const id = String(modelId || '').toLowerCase();
  const paramsB = inferParamsB(id);

  if (/nano|mini|8b|7b|9b|11b|14b|small/.test(id)) return 'compact';
  if (Number.isFinite(paramsB) && paramsB <= 14) return 'compact';
  if (Number.isFinite(paramsB) && paramsB <= 80) return 'balanced';
  if (/gpt-5|405b|397b|480b|sonnet|opus|pro|large/.test(id)) return 'full';
  if (providerId === 'ollama' && /cloud|kimi|minimax|glm/.test(id)) return 'full';
  if (providerId === 'openai') return 'full';
  return 'balanced';
}

function normalizeProfileMap(runtime = {}) {
  const defaults = {
    compact: {
      maxHistoryMessages: 220,
      maxToolIterations: 3,
      allowedTools: [
        'file_read',
        'file_restore_last',
        'session_list',
        'session_delete',
        'session_clear',
        'shell_run',
        'http_request',
        'browser_status',
        'browser_extract',
        'browser_snapshot',
        'skill_list',
        'email_status',
        'research_list_recent'
      ]
    },
    balanced: {
      maxHistoryMessages: 520,
      maxToolIterations: 5,
      allowedTools: []
    },
    full: {
      maxHistoryMessages: 1200,
      maxToolIterations: 8,
      allowedTools: []
    }
  };
  const configured = runtime?.modelExecutionProfiles || {};
  const out = {};
  for (const tier of ['compact', 'balanced', 'full']) {
    const merged = { ...(defaults[tier] || {}), ...(configured[tier] || {}) };
    out[tier] = {
      maxHistoryMessages: Number.isFinite(merged.maxHistoryMessages) ? Number(merged.maxHistoryMessages) : defaults[tier].maxHistoryMessages,
      maxToolIterations: Number.isFinite(merged.maxToolIterations) ? Number(merged.maxToolIterations) : defaults[tier].maxToolIterations,
      allowedTools: Array.isArray(merged.allowedTools) ? merged.allowedTools.map((t) => String(t || '').trim()).filter(Boolean) : []
    };
  }
  return out;
}

export function resolveExecutionEnvelope({ provider, model, runtime = {} }) {
  const tier = inferTier(provider, model);
  const profiles = normalizeProfileMap(runtime);
  const profile = profiles[tier] || profiles.balanced;
  const enforceRestrictions = runtime?.enforceModelExecutionProfiles !== false;
  const toolAllowlist = enforceRestrictions && Array.isArray(profile.allowedTools) && profile.allowedTools.length
    ? [...new Set(profile.allowedTools)]
    : null;

  return {
    tier,
    profile,
    enforceRestrictions,
    toolAllowlist,
    maxHistoryMessages: profile.maxHistoryMessages,
    maxToolIterations: profile.maxToolIterations,
    inferredParamsB: inferParamsB(model)
  };
}
