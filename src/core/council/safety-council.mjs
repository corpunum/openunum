/**
 * Safety Council - Pre-flight middleware for OpenUnum
 *
 * Validates requests before they reach the agent:
 * 1. ODD (Operational Design Domain) enforcement - uses actual execution envelopes
 * 2. Permission checks - uses session state
 * 3. Safety pattern detection - uses ExecutionPolicyEngine for self-protection
 * 4. Tool allowlist enforcement per tier
 */

import { logEvent } from '../audit-log.mjs';
import { resolveExecutionEnvelope } from '../model-execution-envelope.mjs';
import { ExecutionPolicyEngine } from '../execution-policy-engine.mjs';

export class SafetyCouncil {
  constructor({ config, memoryStore }) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.oddConfig = config.runtime?.odd || {};
    this.policyEngine = new ExecutionPolicyEngine(config.runtime || {});
    this.dangerousPatterns = [
      { pattern: /rm\s+-rf\s+\//i, reason: 'recursive_root_deletion' },
      { pattern: /DROP\s+TABLE/i, reason: 'database_destruction' },
      { pattern: /DELETE\s+FROM\s+\w+\s*;\s*$/i, reason: 'unrestricted_delete' },
      { pattern: /rm\s+-rf\s+\*$/i, reason: 'wildcard_deletion' },
      { pattern: /:\(\)\{\s*:\|:&\s*\};:/, reason: 'fork_bomb' },
      { pattern: /chmod\s+-R\s+777\s+\//i, reason: 'dangerous_permissions' },
      { pattern: /dd\s+.*of=\/dev/i, reason: 'device_overwrite' },
      { pattern: /mkfs/i, reason: 'filesystem_destruction' },
      { pattern: /:\(\)\{\s*:\|:&\s*\};:/, reason: 'shell_fork_bomb' }
    ];
  }

  /**
   * Pre-flight check before agent processes a message
   * @param {object} params
   * @param {string} params.message - User message
   * @param {string} params.sessionId - Session identifier
   * @param {object} params.context - Execution context including provider/model info
   * @returns {Promise<{passed: boolean, checks: Array, blockedReason: string|null}>}
   */
  async preFlight({ message, sessionId, context }) {
    const checks = [];
    const results = {
      passed: true,
      checks: [],
      blockedReason: null
    };

    // 1. ODD (Operational Design Domain) Check - uses actual execution envelope
    const oddCheck = this.checkODD(context);
    checks.push({ name: 'odd', passed: oddCheck.passed, reason: oddCheck.reason, details: oddCheck.details });

    // 2. Tool Allowlist Check (if tools are being requested in context)
    if (context?.proposedTools && Array.isArray(context.proposedTools)) {
      const toolCheck = this.checkToolAllowlist(context);
      checks.push({ name: 'tool_allowlist', passed: toolCheck.passed, reason: toolCheck.reason, blocked: toolCheck.blocked });
      if (!toolCheck.passed) {
        results.passed = false;
        results.blockedReason = toolCheck.reason;
      }
    }

    // 3. Permission Check
    const permCheck = await this.checkPermissions(sessionId);
    checks.push({ name: 'permissions', passed: permCheck.passed, reason: permCheck.reason });

    // 4. Safety Check - uses ExecutionPolicyEngine for self-protection patterns
    const safetyCheck = await this.checkSafety(message);
    checks.push({ name: 'safety', passed: safetyCheck.passed, reason: safetyCheck.reason });

    // 5. Self-preservation check (BRAIN.MD principle 5)
    const selfPreservation = this.checkSelfPreservation(message);
    checks.push({ name: 'self_preservation', passed: selfPreservation.passed, reason: selfPreservation.reason });

    // Determine overall result
    const failedCheck = checks.find(c => !c.passed);
    if (failedCheck) {
      results.passed = false;
      results.blockedReason = results.blockedReason || failedCheck.reason;
    }

    // Audit log the council decision
    try {
      logEvent('verification', {
        type: 'council_preflight',
        sessionId,
        checks,
        passed: results.passed,
        blockedReason: results.blockedReason
      }, sessionId);
    } catch (e) {
      console.error('[council_audit_log_failed]', e);
    }

    results.checks = checks;
    return results;
  }

  /**
   * Check Operational Design Domain constraints using actual execution envelope
   * @param {object} context - Execution context with provider/model info
   * @returns {{passed: boolean, reason: string, details?: object}}
   */
  checkODD(context) {
    const provider = context?.provider || this.config.model?.provider;
    const model = context?.model || this.config.model?.model;

    if (!provider || !model) {
      return { passed: true, reason: 'odd_no_context_defaults_to_allow' };
    }

    // Resolve actual execution envelope from the model-execution-envelope module
    const envelope = resolveExecutionEnvelope({
      provider,
      model,
      runtime: this.config.runtime
    });

    // Check if tier restricts tools
    if (envelope.tier === 'compact') {
      const compactAllowed = envelope.toolAllowlist;
      if (compactAllowed && compactAllowed.length === 0) {
        return {
          passed: false,
          reason: 'compact_tier_no_tools_allowed',
          details: { tier: envelope.tier, provider, model }
        };
      }
    }

    // Check if model is allowed for the execution tier
    const modelStr = `${provider}/${model}`.toLowerCase();

    // Weak models should not be in critical execution contexts
    if (envelope.tier === 'compact' && context?.executionTier === 'critical') {
      return {
        passed: false,
        reason: 'weak_model_not_allowed_for_critical_tasks',
        details: { tier: envelope.tier, executionTier: context.executionTier }
      };
    }

    return {
      passed: true,
      reason: 'odd_ok',
      details: { tier: envelope.tier, maxIters: envelope.maxToolIterations, provider, model }
    };
  }

  /**
   * Check tool allowlist for the current execution envelope
   * @param {object} context - Context with proposedTools array
   * @returns {{passed: boolean, reason: string, blocked?: string[]}}
   */
  checkToolAllowlist(context) {
    const provider = context?.provider || this.config.model?.provider;
    const model = context?.model || this.config.model?.model;
    const envelope = resolveExecutionEnvelope({
      provider,
      model,
      runtime: this.config.runtime
    });

    const allowlist = envelope.toolAllowlist;
    if (!allowlist || !Array.isArray(allowlist) || allowlist.length === 0) {
      // No allowlist means all tools are permitted (balanced/full tier)
      return { passed: true, reason: 'no_tier_allowlist_all_tools_permitted' };
    }

    const proposedTools = context.proposedTools;
    const blocked = proposedTools.filter(tool => !allowlist.includes(tool));

    if (blocked.length > 0) {
      return {
        passed: false,
        reason: `tools_blocked_by_tier_allowlist: ${blocked.join(', ')}`,
        blocked
      };
    }

    return { passed: true, reason: 'all_tools_within_allowlist' };
  }

  /**
   * Check session permissions
   * @param {string} sessionId
   * @returns {Promise<{passed: boolean, reason: string}>}
   */
  async checkPermissions(sessionId) {
    if (!this.memoryStore?.getSession) {
      return { passed: true, reason: 'permission_check_unavailable' };
    }

    try {
      const session = this.memoryStore.getSession(sessionId);
      if (!session) {
        // New session, default allow
        return { passed: true, reason: 'new_session_default_allow' };
      }

      // Check for session-level blocks
      if (session.blocked) {
        return { passed: false, reason: 'session_blocked' };
      }

      return { passed: true, reason: 'permissions_ok' };
    } catch (error) {
      console.error('[council_permission_check_failed]', error);
      return { passed: true, reason: 'permission_check_error' };
    }
  }

  /**
   * Check for dangerous patterns in message, delegating to ExecutionPolicyEngine
   * @param {string} message
   * @returns {Promise<{passed: boolean, reason: string}>}
   */
  async checkSafety(message) {
    const normalizedMessage = String(message || '').toLowerCase();

    // Check hardcoded dangerous patterns (SQL injection, filesystem destruction, etc.)
    for (const { pattern, reason } of this.dangerousPatterns) {
      if (pattern.test(normalizedMessage)) {
        return { passed: false, reason: `dangerous_pattern_detected:${reason}` };
      }
    }

    // Delegate shell self-protection checks to ExecutionPolicyEngine
    // This reuses the same self-protection logic used in tool execution
    const policyResult = this.policyEngine.evaluate({
      toolName: 'shell_run',
      args: { cmd: message },
      context: { policyMode: 'execute' }
    });

    if (!policyResult.allow && policyResult.reason === 'self_protection_blocked') {
      return { passed: false, reason: `self_protection_violation: ${policyResult.details || policyResult.reason}` };
    }

    return { passed: true, reason: 'safety_ok' };
  }

  /**
   * Check self-preservation patterns (BRAIN.MD principle 5)
   * The agent cannot and should not kill itself
   * @param {string} message
   * @returns {{passed: boolean, reason: string}}
   */
  checkSelfPreservation(message) {
    const selfHarmPatterns = [
      /delete\s+yourself/i,
      /kill\s+yourself/i,
      /shut\s+down\s+permanently/i,
      /corrupt\s+your/i,
      /destroy\s+your/i,
      /uninstall\s+yourself/i,
      /remove\s+all\s+your\s+(code|files|memory)/i
    ];

    for (const pattern of selfHarmPatterns) {
      if (pattern.test(message)) {
        return { passed: false, reason: 'self_preservation_violation' };
      }
    }

    return { passed: true, reason: 'self_preservation_ok' };
  }
}

/**
 * Factory function
 */
export function createSafetyCouncil(options) {
  return new SafetyCouncil(options);
}
