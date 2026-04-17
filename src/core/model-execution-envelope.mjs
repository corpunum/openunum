export const MODEL_TIER_ORDER = ['compact', 'balanced', 'full'];

export const ODD_MUTATING_TOOLS = new Set([
  'file_write',
  'file_patch',
  'file_restore_last',
  'shell_run',
  'desktop_open',
  'desktop_xdotool',
  'skill_install',
  'skill_approve',
  'skill_execute',
  'skill_uninstall',
  'email_send',
  'gworkspace_call',
  'research_approve'
]);

const DEFAULT_COMPACT_TOOLS = [
  'file_read',
  'file_search',
  'file_grep',
  'file_info',
  'session_list',
  'http_request',
  'browser_status',
  'browser_extract',
  'browser_snapshot',
  'summarize',
  'classify',
  'extract',
  'parse_function_args',
  'embed_text',
  'skill_list',
  'email_status',
  'research_list_recent'
];

const DEFAULT_ODD_POLICIES = {
  compact: {
    maxConfidenceRequired: 0.7,
    allowedTools: DEFAULT_COMPACT_TOOLS,
    blockedTools: ['file_write', 'shell_run', 'file_patch', 'desktop_open', 'desktop_xdotool'],
    requireHumanApproval: true
  },
  balanced: {
    maxConfidenceRequired: 0.5,
    allowedTools: 'all',
    blockedTools: ['desktop_open', 'desktop_xdotool'],
    requireHumanApproval: false
  },
  full: {
    maxConfidenceRequired: 0.3,
    allowedTools: 'all',
    blockedTools: [],
    requireHumanApproval: false
  }
};

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

export function inferTier(provider, modelId) {
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

const REQUIRED_KERNEL_TOOLS = ['session_list'];
const VERY_SMALL_MODEL_TOOLS = [
  'file_read',
  'file_search',
  'file_grep',
  'file_info',
  'session_list',
  'http_request',
  'browser_status',
  'browser_extract',
  'browser_snapshot',
  'summarize',
  'classify',
  'extract',
  'parse_function_args',
  'embed_text'
];

function normalizeProfileMap(runtime = {}) {
  const defaults = {
    compact: {
      maxHistoryMessages: 220,
      maxToolIterations: 3,
      allowedTools: DEFAULT_COMPACT_TOOLS
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

function normalizeOddPolicyMap(runtime = {}) {
  const configuredProfiles = runtime?.modelExecutionProfiles || {};
  const out = {};
  for (const tier of MODEL_TIER_ORDER) {
    const merged = {
      ...(DEFAULT_ODD_POLICIES[tier] || {}),
      ...(configuredProfiles?.[tier]?.odd || {})
    };
    const allowedTools = merged.allowedTools === 'all'
      ? 'all'
      : Array.isArray(merged.allowedTools)
        ? [...new Set(merged.allowedTools.map((tool) => String(tool || '').trim()).filter(Boolean))]
        : 'all';
    out[tier] = {
      maxConfidenceRequired: Number.isFinite(merged.maxConfidenceRequired)
        ? Number(merged.maxConfidenceRequired)
        : DEFAULT_ODD_POLICIES[tier].maxConfidenceRequired,
      allowedTools,
      blockedTools: Array.isArray(merged.blockedTools)
        ? [...new Set(merged.blockedTools.map((tool) => String(tool || '').trim()).filter(Boolean))]
        : [...DEFAULT_ODD_POLICIES[tier].blockedTools],
      requireHumanApproval: merged.requireHumanApproval === true
    };
  }
  return out;
}

export function getOddPolicyForTier(tier, runtime = {}) {
  const normalizedTier = MODEL_TIER_ORDER.includes(String(tier || '').trim()) ? String(tier).trim() : 'full';
  const policies = normalizeOddPolicyMap(runtime);
  return policies[normalizedTier] || policies.full;
}

export function resolveOddPolicy({ provider, model, runtime = {} }) {
  const tier = inferTier(provider, model);
  return {
    tier,
    policy: getOddPolicyForTier(tier, runtime)
  };
}

export function evaluateOddToolAccess({ toolName, confidence, tier, policy = {} }) {
  const normalizedTier = MODEL_TIER_ORDER.includes(String(tier || '').trim()) ? String(tier).trim() : 'full';
  const effectivePolicy = {
    ...(DEFAULT_ODD_POLICIES[normalizedTier] || DEFAULT_ODD_POLICIES.full),
    ...(policy || {})
  };
  const normalizedTool = String(toolName || '').trim();

  if (effectivePolicy.blockedTools.includes(normalizedTool)) {
    return { allowed: false, reason: 'blocked_by_odd', requiresApproval: Boolean(effectivePolicy.requireHumanApproval) };
  }

  const numericConfidence = Number(confidence);
  if (
    ODD_MUTATING_TOOLS.has(normalizedTool) &&
    Number.isFinite(numericConfidence) &&
    numericConfidence < Number(effectivePolicy.maxConfidenceRequired || 0)
  ) {
    return {
      allowed: false,
      reason: 'low_confidence',
      requiresApproval: true
    };
  }

  return { allowed: true };
}

export function resolveExecutionEnvelope({ provider, model, runtime = {} }) {
  const tier = inferTier(provider, model);
  const profiles = normalizeProfileMap(runtime);
  const oddPolicies = normalizeOddPolicyMap(runtime);
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
    verySmallModel,
    oddPolicy: oddPolicies[tier] || oddPolicies.full
  };
}
