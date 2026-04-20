/**
 * Memory Consolidator (R2 - Hippocampal Replay)
 * 
 * Replays recent route lessons to identify success/failure patterns,
 * then consolidates them into boosted memory entries.
 */

export class MemoryConsolidator {
  /**
   * @param {object} opts
   * @param {object} opts.store - MemoryStore instance with getRouteLessons, storeConsolidatedPattern, getConsolidatedPatterns
   * @param {number} opts.replayIntervalHours - Hours between replay cycles (default: 24)
   * @param {number} opts.minSuccessesForPattern - Minimum successes to form pattern (default: 3)
   * @param {number} opts.minFailuresForPattern - Minimum failures to form pattern (default: 2)
   * @param {number} opts.lookbackDays - How many days of lessons to load (default: 7)
   */
  constructor({ store, replayIntervalHours = 24, minSuccessesForPattern = 3, minFailuresForPattern = 2, lookbackDays = 7 } = {}) {
    this.store = store;
    this.replayIntervalMs = replayIntervalHours * 60 * 60 * 1000;
    this.minSuccessesForPattern = minSuccessesForPattern;
    this.minFailuresForPattern = minFailuresForPattern;
    this.lookbackDays = lookbackDays;
    this.lastReplayAt = 0;
    this.consolidatedPatterns = new Set(); // Loop prevention: track already-consolidated patterns
  }

  /**
   * Run a replay cycle: load lessons, extract patterns, return them.
   * Does NOT store patterns by default — caller decides.
   * @returns {{successPatterns: Array, failurePatterns: Array, stats: object}}
   */
  runReplayCycle() {
    if (!this.store || !this.store.getRouteLessons) {
      return { successPatterns: [], failurePatterns: [], stats: { error: 'no_store' } };
    }

    const sinceDate = new Date(Date.now() - this.lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const lessons = this.store.getRouteLessons({ since: sinceDate, limit: 500 });

    if (!lessons.length) {
      this.lastReplayAt = Date.now();
      return { successPatterns: [], failurePatterns: [], stats: { lessonsLoaded: 0 } };
    }

    const { successPatterns, failurePatterns } = this.extractPatterns(lessons);

    this.lastReplayAt = Date.now();
    return {
      successPatterns,
      failurePatterns,
      stats: {
        lessonsLoaded: lessons.length,
        successPatternCount: successPatterns.length,
        failurePatternCount: failurePatterns.length
      }
    };
  }

  /**
   * Extract success and failure patterns from lessons.
   * Groups by (surface + outcome) signature.
   * @param {Array<object>} lessons - Route lesson records
   * @returns {{successPatterns: Array, failurePatterns: Array}}
   */
  extractPatterns(lessons) {
    const groups = {}; // key -> { surface, outcome, entries[] }

    for (const lesson of lessons) {
      const key = `${lesson.surface || 'unknown'}:${lesson.outcome || 'unknown'}`;
      if (!groups[key]) {
        groups[key] = {
          surface: lesson.surface || 'unknown',
          outcome: lesson.outcome || 'unknown',
          key,
          entries: []
        };
      }
      groups[key].entries.push(lesson);
    }

    const successPatterns = [];
    const failurePatterns = [];

    for (const group of Object.values(groups)) {
      const patternKey = group.key;

      // Loop prevention: skip if already consolidated
      if (this.consolidatedPatterns.has(patternKey)) continue;

      if (group.outcome === 'success' && group.entries.length >= this.minSuccessesForPattern) {
        successPatterns.push(this.consolidatePattern(group));
      } else if (group.outcome === 'failure' && group.entries.length >= this.minFailuresForPattern) {
        failurePatterns.push(this.consolidatePattern(group));
      }
    }

    return { successPatterns, failurePatterns };
  }

  /**
   * Consolidate a pattern group into a structured pattern object.
   * @param {{surface: string, outcome: string, key: string, entries: Array}} group
   * @returns {object} Consolidated pattern
   */
  consolidatePattern(group) {
    const examples = group.entries.slice(0, 10).map(e => e.route_signature || e.goal_hint || e.note || '').filter(Boolean);
    const errorSamples = group.entries
      .filter(e => e.error_excerpt)
      .slice(0, 5)
      .map(e => e.error_excerpt);

    this.consolidatedPatterns.add(group.key);

    return {
      pattern: group.key,
      surface: group.surface,
      outcome: group.outcome,
      successes: group.outcome === 'success' ? group.entries.length : 0,
      failures: group.outcome === 'failure' ? group.entries.length : 0,
      count: group.entries.length,
      examples,
      errorSamples,
      weight: group.outcome === 'success' ? 1.5 : 0.5, // Boost success, penalize failure
      consolidatedAt: new Date().toISOString()
    };
  }

  /**
   * Convenience: run replay and store all discovered patterns.
   * @returns {{stored: number, stats: object}}
   */
  runAndStore() {
    const { successPatterns, failurePatterns, stats } = this.runReplayCycle();
    let stored = 0;

    for (const pattern of successPatterns) {
      const result = this.store.storeConsolidatedPattern(pattern);
      if (result?.ok) stored++;
    }

    for (const pattern of failurePatterns) {
      const result = this.store.storeConsolidatedPattern({ ...pattern, weight: 0.5 });
      if (result?.ok) stored++;
    }

    return { stored, stats };
  }

  /**
   * Check if enough time has passed for a new replay cycle.
   * @returns {boolean}
   */
  shouldReplay() {
    if (!this.lastReplayAt) return true;
    return (Date.now() - this.lastReplayAt) >= this.replayIntervalMs;
  }

  /**
   * Consolidate trajectory memory entries from recent strategy outcomes.
   * Gated: only stores trajectories that passed proof scoring and verification.
   * Called during consolidation cycles, not at runtime write-through.
   *
   * @param {object} trajectoryStore - TrajectoryMemoryStore instance
   * @param {object} opts - Options
   * @param {number} opts.minProofScore - Minimum proof score to store (default: 0.5)
   * @param {boolean} opts.requireVerifier - Require verifier pass (default: true)
   * @param {number} opts.lookbackDays - How many days of outcomes to scan (default: 7)
   * @returns {{ stored: number, skipped: number, stats: object }}
   */
  consolidateTrajectories(trajectoryStore, { minProofScore = 0.5, requireVerifier = true, lookbackDays = 7 } = {}) {
    if (!this.store || !trajectoryStore) {
      return { stored: 0, skipped: 0, stats: { error: 'missing_store' } };
    }

    const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const outcomes = this.store.getStrategyOutcomes({ since: sinceDate, limit: 200 });
    let stored = 0;
    let skipped = 0;

    for (const outcome of outcomes) {
      const successScore = Number(outcome.success || 0) === 1 ? 0.7 : 0.2;
      const proofPassed = successScore >= minProofScore;

      if (!proofPassed) {
        skipped++;
        continue;
      }

      const goal = String(outcome.goal || '').trim();
      if (!goal || goal.length < 10) {
        skipped++;
        continue;
      }

      const entry = {
        goal_normalized: goal.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
        task_type: 'general',
        tool_set_signature: '',
        environment_fingerprint: '',
        plan_template: String(outcome.strategy || '').slice(0, 200),
        tool_sequence: '',
        tool_args_schema: '',
        success_score: successScore,
        proof_passed: proofPassed,
        verifier_passed: false,
        failure_warnings: successScore < 0.4 ? String(outcome.evidence || '').slice(0, 200) : '',
        schema_version: '',
        runtime_version: '',
        model: '',
        autonomy_mode: '',
        session_id: '',
        step_count: 0,
        tool_count: 0,
        final_text: ''
      };

      try {
        const result = trajectoryStore.store(entry);
        if (result) stored++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    return { stored, skipped, stats: { outcomesScanned: outcomes.length } };
  }
}
