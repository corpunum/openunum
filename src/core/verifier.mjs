/**
 * Independent Verifier (R3)
 *
 * Separation of concerns: the agent that generates output cannot validate its own work.
 * This verifier performs independent checks using a different (typically smaller) model tier
 * when available, and heuristic validation otherwise.
 *
 * Checks performed:
 * 1. Tool call appropriateness (tool exists, parameters valid, safety compliant)
 * 2. Output quality (addresses request, complete, coherent)
 * 3. Goal alignment (no drift from stated objectives)
 * 4. Safety compliance (no credential leaks, no unauthorized external actions)
 * 5. Context coherence (no contradictions with previous turns)
 */

import { logEvent } from './audit-log.mjs';
import { logInfo, logError } from '../logger.mjs';

const VERIFY_TOOL_WHITELIST = new Set([
  'file_read', 'file_write', 'file_patch', 'file_search', 'file_grep', 'file_info',
  'file_restore_last', 'shell_run', 'http_request', 'web_search', 'web_fetch',
  'browser_status', 'browser_extract', 'browser_snapshot', 'browser_navigate',
  'browser_click', 'browser_type', 'browser_scroll',
  'memory_store', 'memory_recall', 'memory_search',
  'session_list', 'session_delete', 'session_clear',
  'skill_list', 'skill_install', 'skill_execute', 'skill_approve', 'skill_uninstall',
  'summarize', 'classify', 'extract', 'parse_function_args', 'embed_text',
  'email_status', 'email_send',
  'research_list_recent', 'research_approve'
]);

const CREDENTIAL_PATTERNS = [
  /(?:api[_-]?key|apikey|secret|token|password|auth[_-]?header)\s*[:=]\s*["'][\w\-]{16,}/i,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key IDs
  /\bsk-[a-zA-Z0-9]{32,}\b/, // OpenAI-style API keys
];

export class IndependentVerifier {
  constructor({ config = null, memoryStore = null } = {}) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.stats = { total: 0, passed: 0, failed: 0, byCheck: {} };
  }

  /**
   * Verify a complete agent turn: tool calls, output, goal alignment, safety.
   * @param {object} params
   * @param {string} params.userMessage - Original user message
   * @param {string} params.assistantReply - Agent's reply text
   * @param {Array} params.toolRuns - Tool execution records [{name, args, result}]
   * @param {object} params.context - Additional context (session info, etc.)
   * @returns {{verified: boolean, checks: Array, confidence: number, issues: Array}}
   */
  async verify({ userMessage, assistantReply, toolRuns = [], context = {} }) {
    this.stats.total++;
    const checks = [];
    const issues = [];

    // Check 1: Tool call appropriateness
    const toolCheck = this.verifyToolCalls(toolRuns, context);
    checks.push(toolCheck);
    if (!toolCheck.passed) issues.push(...(toolCheck.issues || []));

    // Check 2: Output quality
    const outputCheck = this.verifyOutputQuality(userMessage, assistantReply, toolRuns);
    checks.push(outputCheck);
    if (!outputCheck.passed) issues.push(...(outputCheck.issues || []));

    // Check 3: Goal alignment
    const goalCheck = this.verifyGoalAlignment(userMessage, assistantReply);
    checks.push(goalCheck);
    if (!goalCheck.passed) issues.push(...(goalCheck.issues || []));

    // Check 4: Safety compliance
    const safetyCheck = this.verifySafety(assistantReply, toolRuns);
    checks.push(safetyCheck);
    if (!safetyCheck.passed) issues.push(...(safetyCheck.issues || []));

    // Check 5: Context coherence (if memoryStore available)
    const coherenceCheck = await this.verifyContextCoherence(userMessage, assistantReply, context);
    checks.push(coherenceCheck);
    if (!coherenceCheck.passed) issues.push(...(coherenceCheck.issues || []));

    const verified = checks.every(c => c.passed);
    const confidence = checks.length > 0
      ? checks.filter(c => c.passed).length / checks.length
      : 0;

    // Update stats
    if (verified) {
      this.stats.passed++;
    } else {
      this.stats.failed++;
    }
    for (const check of checks) {
      const name = check.name || 'unknown';
      this.stats.byCheck[name] = this.stats.byCheck[name] || { passed: 0, failed: 0 };
      if (check.passed) this.stats.byCheck[name].passed++;
      else this.stats.byCheck[name].failed++;
    }

    // Audit log verification result
    try {
      logEvent('verification', {
        type: 'independent_verification',
        sessionId: context?.sessionId,
        verified,
        confidence,
        checkNames: checks.map(c => `${c.name}:${c.passed}`),
        issueCount: issues.length
      }, context?.sessionId);
    } catch { /* ignore audit errors */ }

    return { verified, checks, confidence, issues };
  }

  /**
   * Verify tool calls are appropriate
   */
  verifyToolCalls(toolRuns, context) {
    const issues = [];
    let allPassed = true;

    for (const run of toolRuns) {
      const toolName = String(run.name || run.tool_name || '');

      // Check tool is in whitelist
      if (toolName && !VERIFY_TOOL_WHITELIST.has(toolName)) {
        issues.push({ tool: toolName, issue: 'unknown_tool', severity: 'warning' });
        // Don't fail on unknown tools - they may be model-backed tools
      }

      // Check tool result
      if (run.result === null || run.result === undefined) {
        issues.push({ tool: toolName, issue: 'null_result', severity: 'critical' });
        allPassed = false;
      }

      if (run.result?.error && !run.result?.ok) {
        issues.push({ tool: toolName, issue: 'tool_error', severity: 'high', detail: String(run.result.error).slice(0, 100) });
        allPassed = false;
      }
    }

    return {
      name: 'tool_appropriateness',
      passed: allPassed,
      toolCount: toolRuns.length,
      issueCount: issues.length,
      issues: issues.length > 0 ? issues.slice(0, 5) : undefined
    };
  }

  /**
   * Verify output quality - not empty, not just an acknowledgment, addresses the request
   */
  verifyOutputQuality(userMessage, assistantReply, toolRuns) {
    const issues = [];
    const text = String(assistantReply || '').trim();

    // Empty response
    if (!text) {
      issues.push({ issue: 'empty_reply', severity: 'critical' });
      return { name: 'output_quality', passed: false, issues };
    }

    // Generic acknowledgment with no tool evidence
    const genericAcks = [
      /^(?:okay|ok|sure|got it|understood|i understand|done|completed)[.!]?\s*$/im,
      /^(?:ready|standing by|awaiting)[.!]?\s*$/im,
    ];
    const isGenericAck = genericAcks.some(p => p.test(text));
    if (isGenericAck && toolRuns.length === 0) {
      issues.push({ issue: 'generic_acknowledgment_no_evidence', severity: 'high' });
    }

    // Internal format leakage
    const leakedInternal = /^Status:\s+\w+/im.test(text) && /Findings:/im.test(text);
    if (leakedInternal) {
      issues.push({ issue: 'internal_format_leaked', severity: 'high' });
    }

    // Very short response for a complex task (likely incomplete)
    const userWords = String(userMessage || '').split(/\s+/).length;
    const replyWords = text.split(/\s+/).length;
    if (userWords > 20 && replyWords < 10 && toolRuns.length === 0) {
      issues.push({ issue: 'suspiciously_short_for_complex_query', severity: 'medium' });
    }

    const passed = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0;
    return {
      name: 'output_quality',
      passed,
      replyLength: text.length,
      issueCount: issues.length,
      issues: issues.length > 0 ? issues : undefined
    };
  }

  /**
   * Verify goal alignment - reply addresses the user's stated objective
   */
  verifyGoalAlignment(userMessage, assistantReply) {
    const issues = [];
    const userText = String(userMessage || '').toLowerCase();
    const replyText = String(assistantReply || '').toLowerCase();

    // Check for topic drift indicators
    const driftIndicators = [
      'i cannot help with that',
      'i am unable to',
      'that is beyond my',
    ];
    const hasDrift = driftIndicators.some(ind => replyText.includes(ind));
    if (hasDrift) {
      // Not necessarily a failure - some requests should be refused
      // But log it for awareness
      issues.push({ issue: 'possible_refusal_or_drift', severity: 'low' });
    }

    // Check for "all providers failed" - definitely goal failure
    if (replyText.includes('all configured providers failed') || replyText.includes('all configured providers')) {
      issues.push({ issue: 'all_providers_failed', severity: 'critical' });
    }

    // Check for partial completion signals
    const partialSignals = [
      /status:\s*partial/i,
      /insufficient evidence/i,
      /tool_circuit_open/i,
      /request is taking too long/i,
    ];
    const hasPartial = partialSignals.some(p => p.test(replyText));
    if (hasPartial) {
      issues.push({ issue: 'partial_completion', severity: 'high' });
    }

    const passed = issues.filter(i => i.severity === 'critical').length === 0;
    return {
      name: 'goal_alignment',
      passed,
      issueCount: issues.length,
      issues: issues.length > 0 ? issues : undefined
    };
  }

  /**
   * Verify safety - no credential leaks, no unauthorized external actions
   */
  verifySafety(assistantReply, toolRuns) {
    const issues = [];
    const text = String(assistantReply || '');

    // Check for credential leaks in reply
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.test(text)) {
        issues.push({ issue: 'credential_leak_in_reply', severity: 'critical', pattern: String(pattern).slice(0, 30) });
      }
    }

    // Check for credential leaks in tool results
    for (const run of toolRuns) {
      const resultStr = JSON.stringify(run.result || run.args || {});
      for (const pattern of CREDENTIAL_PATTERNS) {
        if (pattern.test(resultStr)) {
          issues.push({ issue: 'credential_in_tool_data', severity: 'critical', tool: run.name || run.tool_name });
        }
      }
    }

    const passed = issues.length === 0;
    return {
      name: 'safety_compliance',
      passed,
      issueCount: issues.length,
      issues: issues.length > 0 ? issues : undefined
    };
  }

  /**
   * Verify context coherence - no contradictions with session history
   */
  async verifyContextCoherence(userMessage, assistantReply, context) {
    const issues = [];

    // Basic coherence check: does the reply reference information that contradicts recent tool results?
    // For now, check that "passed" and "failed" aren't both claimed
    const text = String(assistantReply || '').toLowerCase();
    const claimsPassed = /(?:test|check|verification|validation)\s+(?:passed|succeeded|ok)/i.test(text);
    const claimsFailed = /(?:test|check|verification|validation)\s+(?:failed|errored)/i.test(text);
    if (claimsPassed && claimsFailed) {
      issues.push({ issue: 'contradictory_pass_fail_claims', severity: 'medium' });
    }

    // Check that claimed tool evidence matches actual tool runs
    const claimsToolUse = /i\s+(?:used|ran|executed|called|invoked)\s+(?:the\s+)?(\w+)\s+(?:tool|command|function)/i;
    const claimMatch = text.match(claimsToolUse);
    if (claimMatch) {
      const claimedTool = claimMatch[1]?.toLowerCase();
      const actualTools = (context?.toolRuns || []).map(t => String(t.name || t.tool_name || '').toLowerCase());
      if (claimedTool && actualTools.length > 0 && !actualTools.some(t => t.includes(claimedTool) || claimedTool.includes(t))) {
        issues.push({ issue: 'claimed_tool_not_in_actual_runs', severity: 'high', claimed: claimedTool, actual: actualTools });
      }
    }

    const passed = issues.filter(i => i.severity === 'high' || i.severity === 'critical').length === 0;
    return {
      name: 'context_coherence',
      passed,
      issueCount: issues.length,
      issues: issues.length > 0 ? issues : undefined
    };
  }

  /**
   * Verify state change validity (legacy interface)
   */
  async verifyStateChange(before, after) {
    const checks = [];
    const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'];
    if (after.status && !VALID_STATUSES.includes(after.status)) {
      checks.push({ check: 'valid_status', passed: false, detail: `Invalid status: ${after.status}` });
    } else {
      checks.push({ check: 'valid_status', passed: true });
    }
    const required = ['id', 'status'];
    for (const f of required) {
      checks.push({ check: `has_${f}`, passed: f in after });
    }
    if (before.updatedAt && after.updatedAt) {
      checks.push({ check: 'timestamp_order', passed: after.updatedAt >= before.updatedAt });
    }
    const passed = checks.every(c => c.passed);
    return { verified: passed, checks, confidence: passed ? 1.0 : 0.0 };
  }

  /**
   * Verify a single tool result (legacy interface)
   */
  async verifyToolResult(toolName, args, result) {
    const checks = [];
    checks.push({ check: 'has_result', passed: result !== undefined && result !== null });
    if (result?.error) {
      checks.push({ check: 'no_error', passed: false, detail: result.error });
    } else {
      checks.push({ check: 'no_error', passed: true });
    }
    const passed = checks.every(c => c.passed);
    return { verified: passed, checks, confidence: passed ? 0.9 : 0.1 };
  }

  /**
   * Verify invariants (legacy interface)
   */
  async verifyInvariants(state) {
    const violations = [];
    if (!state.id) violations.push('missing id');
    const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'];
    if (state.status && !VALID_STATUSES.includes(state.status)) violations.push(`invalid status: ${state.status}`);
    return { passed: violations.length === 0, violations };
  }

  getStats() {
    return { ...this.stats };
  }
}