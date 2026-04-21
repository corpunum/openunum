/**
 * Trajectory Retriever
 *
 * Retrieves similar past trajectories at inference time and builds
 * a bounded "similar cases" context packet for injection into the
 * Context Compiler as Layer 3.5 (between anchor and recalled memories).
 *
 * This is NOT injected into the working-memory anchor by default.
 * It is a separate, filtered, compact packet.
 *
 * Compatibility checks before reuse:
 * - tool_set_signature compatibility
 * - schema_version match
 * - environment_fingerprint match
 * - model/adapter version compatibility
 */

import { logInfo } from '../logger.mjs';

const MAX_TRAJECTORY_PACKET_TOKENS = 600;
const MIN_SIMILARITY_TERMS = 2;

export class TrajectoryRetriever {
  constructor({ trajectoryStore, config = {} } = {}) {
    this.store = trajectoryStore;
    this.enabled = config.trajectoryRetrieval !== false;
    this.maxResults = config.maxTrajectoryResults || 3;
    this.minScore = config.minTrajectoryScore || 0.5;
    this.maxPacketChars = config.maxTrajectoryPacketChars || MAX_TRAJECTORY_PACKET_TOKENS * 4;
  }

  /**
   * Retrieve similar trajectories and build a context packet.
   *
   * @param {object} options
   * @param {string} options.userGoal - The current user prompt/goal
   * @param {string} options.taskType - Classified task type (general, tool_call, multi_turn, planning, coding, browser)
   * @param {string[]} options.availableTools - Tool names currently available in the execution envelope
   * @param {string} options.model - Current model identifier
   * @param {string} options.autonomyMode - Current autonomy mode
   * @param {string} options.schemaVersion - Current tool-schema version
   * @param {string} options.environmentFingerprint - Current environment fingerprint
   * @returns {{ packet: string, matches: Array, failureWarnings: string }}
   */
  retrieve({ userGoal, taskType = 'general', availableTools = [], model = '', autonomyMode = '', schemaVersion = '', environmentFingerprint = '' }) {
    if (!this.enabled || !this.store) {
      return { packet: '', matches: [], failureWarnings: '' };
    }

    const normalizedGoal = this._normalizeGoal(userGoal);
    if (!normalizedGoal) {
      return { packet: '', matches: [], failureWarnings: '' };
    }

    // Retrieve successful trajectories
    const matches = this.store.retrieveByGoal({
      query: normalizedGoal,
      limit: this.maxResults * 2, // Retrieve extra, then filter
      minScore: this.minScore,
      taskType
    });

    // Retrieve failure trajectories for warnings
    const failures = this.store.retrieveFailures({
      query: normalizedGoal,
      limit: 2,
      maxScore: 0.35
    });

    // Apply compatibility filters
    const compatible = matches.filter(entry =>
      this._isCompatible(entry, { availableTools, schemaVersion, environmentFingerprint, model })
    ).slice(0, this.maxResults);

    // Build failure warnings
    const failureWarnings = this._buildFailureWarnings(failures, normalizedGoal);

    // Build context packet
    const packet = this._buildPacket(compatible, failureWarnings);

    logInfo('trajectory_retrieval', {
      goal: normalizedGoal.slice(0, 60),
      retrieved: matches.length,
      compatible: compatible.length,
      failures: failures.length,
      packetChars: packet.length
    });

    return { packet, matches: compatible, failureWarnings };
  }

  /**
   * Check compatibility between a stored trajectory and the current environment.
   */
  _isCompatible(entry, { availableTools, schemaVersion, environmentFingerprint, model }) {
    // Tool set compatibility: at least 60% of trajectory's tools must be available
    if (entry.tool_set_signature && availableTools.length > 0) {
      const trajTools = entry.tool_set_signature.split(',').filter(Boolean);
      const availableSet = new Set(availableTools);
      const overlap = trajTools.filter(t => availableSet.has(t)).length;
      if (trajTools.length > 0 && overlap / trajTools.length < 0.6) return false;
    }

    // Schema version: exact match preferred, but don't reject if missing
    if (entry.schema_version && schemaVersion && entry.schema_version !== schemaVersion) {
      // Allow minor version differences
      const [entryMajor] = entry.schema_version.split('.');
      const [currentMajor] = schemaVersion.split('.');
      if (entryMajor !== currentMajor) return false;
    }

    // Environment fingerprint: if stored, must match
    if (entry.environment_fingerprint && environmentFingerprint) {
      if (entry.environment_fingerprint !== environmentFingerprint) return false;
    }

    // Model: don't reject on model mismatch (different models can use same patterns)
    // but note it in the packet

    return true;
  }

  /**
   * Normalize a goal string for retrieval.
   */
  _normalizeGoal(goal) {
    if (!goal) return '';
    return String(goal)
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  /**
   * Build compact failure warnings from past failures.
   */
  _buildFailureWarnings(failures, normalizedGoal) {
    if (!failures.length) return '';

    const lines = failures.map(f => {
      const warning = String(f.failure_warnings || '').trim();
      const tools = String(f.tool_sequence || '').trim();
      const reason = warning || `score=${f.success_score?.toFixed(2)}`;
      return `- ${reason}${tools ? ` (tools: ${tools.slice(0, 60)})` : ''}`;
    });

    return lines.join('\n');
  }

  /**
   * Build the Layer 3.5 context packet.
   *
   * This is a separate bounded section, NOT injected into the anchor.
   * Structure:
   * - Similar cases that succeeded
   * - Plan templates (distilled, not raw prompts)
   * - Failure warnings from similar cases that failed
   */
  _buildPacket(matches, failureWarnings) {
    if (!matches.length && !failureWarnings) return '';

    const parts = ['## Similar Prior Cases'];

    for (const m of matches) {
      const score = m.success_score?.toFixed(2) || '?';
      const planLines = [];

      if (m.plan_template) {
        // Distilled plan template, not raw prompt
        const template = String(m.plan_template).slice(0, 200);
        planLines.push(`  Plan: ${template}`);
      }

      if (m.tool_sequence) {
        const tools = String(m.tool_sequence).slice(0, 100);
        planLines.push(`  Tools: ${tools}`);
      }

      if (m.task_type && m.task_type !== 'general') {
        planLines.push(`  Type: ${m.task_type}`);
      }

      parts.push(`### Case (score: ${score})`);
      parts.push(...planLines);
      parts.push('');
    }

    if (failureWarnings) {
      parts.push('### Warnings From Similar Failures');
      parts.push(failureWarnings);
      parts.push('');
    }

    const packet = parts.join('\n');

    // Bounded: truncate if too long
    if (packet.length > this.maxPacketChars) {
      return packet.slice(0, this.maxPacketChars) + '\n\n[... truncated ...]';
    }

    return packet;
  }
}

/**
 * Extract a trajectory memory entry from a completed agent run.
 * Called during consolidation cycles, not at runtime write-through.
 */
export function extractTrajectoryMemory({ goal, plan, toolRuns = [], successScore = 0, proofPassed = false, verifierPassed = false, model = '', autonomyMode = '', sessionId = '', schemaVersion = '', runtimeVersion = '' }) {
  const normalizedGoal = String(goal || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

  if (!normalizedGoal) return null;

  const toolNames = toolRuns.map(t => t?.name || '').filter(Boolean);
  const toolSetSig = [...new Set(toolNames)].sort().join(',');

  // Extract plan template (distilled, not raw)
  const planTemplate = String(plan || '')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(' → ');

  const toolSequence = toolNames.join(' → ');
  const toolArgsSchema = toolRuns
    .filter(t => t?.name && t?.args)
    .slice(0, 8)
    .map(t => `${t.name}(${Object.keys(t.args || {}).join(',')})`)
    .join(', ');

  const failureWarnings = toolRuns
    .filter(t => t?.result?.ok === false || t?.result?.error)
    .map(t => `${t.name}: ${String(t.result?.error || 'failed').slice(0, 80)}`)
    .join('; ');

  return {
    goal_normalized: normalizedGoal,
    task_type: classifyTaskType(normalizedGoal, toolNames),
    tool_set_signature: toolSetSig,
    environment_fingerprint: '',
    plan_template: planTemplate,
    tool_sequence: toolSequence,
    tool_args_schema: toolArgsSchema,
    success_score: successScore,
    proof_passed: proofPassed,
    verifier_passed: verifierPassed,
    failure_warnings: failureWarnings,
    schema_version: schemaVersion,
    runtime_version: runtimeVersion,
    model,
    autonomy_mode: autonomyMode,
    session_id: sessionId,
    step_count: toolRuns.length,
    tool_count: toolNames.length,
    final_text: ''
  };
}

function classifyTaskType(goal, toolNames) {
  const g = String(goal || '').toLowerCase();
  const tools = new Set(toolNames.map(t => t.toLowerCase()));

  if (tools.has('browser_navigate') || tools.has('browser_click') || tools.has('browser_search')) return 'browser';
  if (tools.has('file_read') && tools.has('file_write')) return 'coding';
  if (tools.has('shell_run') && (g.includes('build') || g.includes('test') || g.includes('deploy'))) return 'coding';
  if (toolNames.length >= 3) return 'multi_turn';
  if (toolNames.length >= 1) return 'tool_call';
  return 'general';
}
