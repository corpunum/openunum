const MUTATING_TOOLS = new Set([
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

const RECOVERY_TOOLS = new Set(['file_restore_last']);

const SELF_PROTECTION_COMMAND_PATTERNS = [
  /\bpkill\b.*\b(openunum|node|server\.mjs)\b/i,
  /\bkillall\b.*\b(node|openunum)\b/i,
  /\bsystemctl\s+(stop|disable|kill)\s+openunum\b/i,
  /\bservice\s+openunum\s+(stop|disable|kill)\b/i,
  /\brm\s+-rf\s+\/?home\/?corp-unum\/?openunum\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fdx\b/i,
  /:\(\)\s*\{.*\};\s*:/
];

function normalizeMode(value) {
  const mode = String(value || 'execute').trim().toLowerCase();
  return mode === 'plan' ? 'plan' : 'execute';
}

export function buildPolicyConfig(runtime = {}) {
  const input = runtime?.autonomyPolicy || {};
  return {
    enabled: input.enabled !== false,
    mode: normalizeMode(input.mode || 'execute'),
    enforceSelfProtection: input.enforceSelfProtection !== false,
    blockShellSelfDestruct: input.blockShellSelfDestruct !== false,
    allowRecoveryToolsInPlan: input.allowRecoveryToolsInPlan !== false,
    denyMutatingToolsInPlan: input.denyMutatingToolsInPlan !== false
  };
}

export class ExecutionPolicyEngine {
  constructor(runtime = {}) {
    this.config = buildPolicyConfig(runtime);
  }

  evaluate({ toolName, args = {}, context = {} }) {
    const cfg = this.config;
    if (!cfg.enabled) {
      return { allow: true, reason: 'policy_disabled' };
    }

    const tool = String(toolName || '').trim();
    const mode = normalizeMode(context.policyMode || cfg.mode);

    if (
      mode === 'plan' &&
      cfg.denyMutatingToolsInPlan &&
      MUTATING_TOOLS.has(tool) &&
      !(cfg.allowRecoveryToolsInPlan && RECOVERY_TOOLS.has(tool))
    ) {
      return {
        allow: false,
        reason: 'plan_mode_mutation_blocked',
        details: `Tool ${tool} is blocked in plan mode.`
      };
    }

    if (tool === 'shell_run' && cfg.enforceSelfProtection && cfg.blockShellSelfDestruct) {
      const cmd = String(args?.cmd || '').trim();
      const matched = SELF_PROTECTION_COMMAND_PATTERNS.find((pattern) => pattern.test(cmd));
      if (matched) {
        return {
          allow: false,
          reason: 'self_protection_blocked',
          details: 'Shell command matched self-protection policy and was blocked.'
        };
      }
    }

    return { allow: true, reason: 'allowed' };
  }
}

/**
 * Check ODD (Operational Design Domain) constraints for a tool
 * @param {string} toolName - Name of the tool to check
 * @param {number} confidence - Current confidence score (0-1)
 * @param {string} tier - Execution tier (compact, balanced, full)
 * @returns {{ allowed: boolean, reason?: string, requiresApproval?: boolean }}
 */
export function checkODD(toolName, confidence, tier) {
  const ODD_MUTATING_TOOLS = new Set([
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

  const tierOdd = {
    compact: {
      maxConfidenceRequired: 0.7,
      allowedTools: ['file_read', 'http_request', 'browser_snapshot', 'skill_list', 'email_status', 'research_list_recent'],
      blockedTools: ['file_write', 'shell_run', 'file_patch', 'desktop_open', 'desktop_xdotool'],
      requireHumanApproval: true
    },
    balanced: {
      maxConfidenceRequired: 0.5,
      allowedTools: ['file_read', 'file_write', 'file_patch', 'http_request', 'browser_snapshot', 'browser_extract', 'shell_run'],
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

  const odd = tierOdd[tier] || tierOdd.full;

  // Check if tool is in blockedTools
  if (odd.blockedTools.includes(toolName)) {
    return { allowed: false, reason: 'blocked_by_odd' };
  }

  // Check if tool is mutating and confidence is below threshold
  const isMutating = ODD_MUTATING_TOOLS.has(toolName);
  if (isMutating && confidence < odd.maxConfidenceRequired) {
    return { allowed: false, reason: 'low_confidence' };
  }

  return { allowed: true };
}
