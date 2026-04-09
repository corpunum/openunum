function inferParamsB(modelId) {
  const text = String(modelId || '').toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)b/);
  return match ? Number(match[1]) : null;
}

function hasSizedToken(modelId, sizeToken) {
  const text = String(modelId || '').toLowerCase();
  return new RegExp(`(^|[^0-9])${String(sizeToken)}b($|[^0-9])`).test(text);
}

function hasWordToken(modelId, token) {
  const text = String(modelId || '').toLowerCase();
  return new RegExp(`(^|[^a-z0-9])${String(token).toLowerCase()}($|[^a-z0-9])`).test(text);
}

function inferTier(provider, modelId) {
  const providerId = String(provider || '').toLowerCase();
  const id = String(modelId || '').toLowerCase();
  const paramsB = inferParamsB(id);

  if (
    /gpt-5/.test(id) ||
    hasSizedToken(id, 405) ||
    hasSizedToken(id, 397) ||
    hasSizedToken(id, 480) ||
    hasWordToken(id, 'sonnet') ||
    hasWordToken(id, 'opus')
  ) return 'full';
  if (
    hasWordToken(id, 'nano') ||
    hasWordToken(id, 'mini') ||
    hasWordToken(id, 'small') ||
    hasSizedToken(id, 7) ||
    hasSizedToken(id, 8) ||
    hasSizedToken(id, 9) ||
    hasSizedToken(id, 11) ||
    hasSizedToken(id, 14)
  ) return 'compact';
  if (Number.isFinite(paramsB) && paramsB <= 14) return 'compact';
  if (Number.isFinite(paramsB) && paramsB <= 80) return 'balanced';
  if ((providerId === 'ollama' || providerId === 'ollama-cloud') && /cloud|kimi|minimax|glm/.test(id)) return 'full';
  if (providerId === 'openai') return 'full';
  return 'balanced';
}

const REQUIRED_KERNEL_TOOLS = ['session_list', 'session_delete', 'session_clear', 'file_write', 'file_patch'];
const VERY_SMALL_MODEL_TOOLS = [
  'file_read',
  'file_write',
  'file_patch',
  'file_restore_last',
  'session_list',
  'shell_run',
  'http_request',
  'browser_status',
  'browser_extract',
  'browser_snapshot'
];

function normalizeProfileMap(runtime = {}) {
  const defaults = {
    compact: {
      maxHistoryMessages: 220,
      maxToolIterations: 3,
      allowedTools: [
        'file_read',
        'file_write',
        'file_patch',
        'file_restore_last',
        'session_list',
        'session_delete',
        'session_clear',
        'shell_run',
        'http_request',
        'browser_status',
        'browser_extract',
        'browser_snapshot',
        'summarize',
        'classify',
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
    const configuredAllowedTools = Array.isArray(merged.allowedTools)
      ? merged.allowedTools.map((t) => String(t || '').trim()).filter(Boolean)
      : [];
    const includeKernelTools = merged.includeKernelTools !== false;
    const withKernelTools = configuredAllowedTools.length
      ? (includeKernelTools ? [...new Set([...configuredAllowedTools, ...REQUIRED_KERNEL_TOOLS])] : configuredAllowedTools)
      : configuredAllowedTools;
    out[tier] = {
      maxHistoryMessages: Number.isFinite(merged.maxHistoryMessages) ? Number(merged.maxHistoryMessages) : defaults[tier].maxHistoryMessages,
      maxToolIterations: Number.isFinite(merged.maxToolIterations) ? Number(merged.maxToolIterations) : defaults[tier].maxToolIterations,
      allowedTools: withKernelTools,
      includeKernelTools
    };
  }
  return out;
}

export function resolveExecutionEnvelope({ provider, model, runtime = {} }) {
  const tier = inferTier(provider, model);
  const profiles = normalizeProfileMap(runtime);
  const profile = profiles[tier] || profiles.balanced;
  const inferredParams = inferParamsB(model);
  const verySmallModel = Number.isFinite(inferredParams) && inferredParams <= 8;
  const constrainedProfile = verySmallModel
    ? {
      ...profile,
      maxHistoryMessages: Math.min(Number(profile.maxHistoryMessages || 220), 140),
      maxToolIterations: Math.min(Number(profile.maxToolIterations || 3), 2),
      allowedTools: Array.isArray(profile.allowedTools) && profile.allowedTools.length
        ? profile.allowedTools.filter((tool) => VERY_SMALL_MODEL_TOOLS.includes(tool))
        : VERY_SMALL_MODEL_TOOLS
    }
    : profile;
  const enforceRestrictions = runtime?.enforceModelExecutionProfiles !== false;
  const toolAllowlist = enforceRestrictions && Array.isArray(constrainedProfile.allowedTools) && constrainedProfile.allowedTools.length
    ? [...new Set(constrainedProfile.allowedTools)]
    : null;

  return {
    tier,
    profile: constrainedProfile,
    enforceRestrictions,
    toolAllowlist,
    maxHistoryMessages: constrainedProfile.maxHistoryMessages,
    maxToolIterations: constrainedProfile.maxToolIterations,
    inferredParamsB: inferredParams,
    verySmallModel
  };
}
