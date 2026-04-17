/**
 * Proof Scorer Council - Post-flight middleware for OpenUnum
 *
 * Validates agent responses before they reach the user:
 * 1. Proof quality scoring
 * 2. Evidence verification
 * 3. Claim validation
 */

import { scoreProofQuality } from '../proof-scorer.mjs';
import { logEvent } from '../audit-log.mjs';

export class ProofScorerCouncil {
  constructor({ config }) {
    this.config = config;
    this.minProofScore = config.runtime?.minProofScore || 0.7;
    this.requireEvidenceForClaims = config.runtime?.requireEvidenceForClaims !== false;
  }

  /**
   * Post-flight check after agent generates a response
   * @param {object} params
   * @param {string} params.response - Agent's response text
   * @param {Array} params.toolRuns - Executed tool runs
   * @param {string} params.message - Original user message
   * @param {string} params.sessionId - Session identifier
   * @returns {Promise<{passed: boolean, proofScore: object, requiresRevision: boolean}>}
   */
  async postFlight({ response, toolRuns, message, sessionId }) {
    const results = {
      passed: true,
      proofScore: null,
      requiresRevision: false,
      reason: null
    };

    // Score the proof quality
    try {
      const proofScore = scoreProofQuality({
        assistantText: response,
        toolRuns: toolRuns || [],
        taskGoal: message
      });

      results.proofScore = proofScore;
      const overallScore = Number(proofScore.score ?? proofScore.overallScore ?? 0);

      // Check if proof score meets threshold
      if (overallScore < this.minProofScore) {
        results.passed = false;
        results.requiresRevision = true;
        results.reason = `proof_quality_insufficient: score ${overallScore.toFixed(2)} < threshold ${this.minProofScore}`;
      }

      // Check for unsupported claims
      if (this.requireEvidenceForClaims) {
        const claimCheck = this.checkForUnsupportedClaims(response, toolRuns);
        if (!claimCheck.passed) {
          results.passed = false;
          results.requiresRevision = true;
          results.reason = claimCheck.reason;
        }
      }
    } catch (error) {
      console.error('[proof_scorer_council_failed]', error);
      results.proofScore = { error: error.message, overallScore: 0 };
      results.passed = false;
      results.requiresRevision = true;
      results.reason = 'proof_scoring_error';
    }

    // Audit log the council decision
    try {
      logEvent('verification', {
        type: 'council_postflight',
        sessionId,
        proofScore: results.proofScore,
        passed: results.passed,
        requiresRevision: results.requiresRevision,
        reason: results.reason,
        minRequired: this.minProofScore
      }, sessionId);
    } catch (e) {
      console.error('[council_audit_log_failed]', e);
    }

    return results;
  }

  /**
   * Check for unsupported claims in the response
   * @param {string} response - Agent's response
   * @param {Array} toolRuns - Executed tool runs
   * @returns {{passed: boolean, reason: string}}
   */
  checkForUnsupportedClaims(response, toolRuns) {
    const claimPatterns = [
      { pattern: /I (verified|confirmed|checked|tested)/i, type: 'verification_claim' },
      { pattern: /The (test|tests|verification) (passed|succeeded)/i, type: 'test_success_claim' },
      { pattern: /All (\d+) (steps|checks) (completed|passed)/i, type: 'completion_claim' },
      { pattern: /Everything is working/i, type: 'universal_claim' },
      { pattern: /No (errors|issues|problems) found/i, type: 'negative_finding_claim' }
    ];

    const foundClaims = [];
    for (const { pattern, type } of claimPatterns) {
      if (pattern.test(response)) {
        foundClaims.push(type);
      }
    }

    // If claims were made but no tools were run, flag it
    if (foundClaims.length > 0 && (!toolRuns || toolRuns.length === 0)) {
      return {
        passed: false,
        reason: `unsupported_claims: ${foundClaims.join(', ')} without tool evidence`
      };
    }

    // Strong claims require strong evidence
    const strongClaimPatterns = [
      /100% confident/i,
      /absolutely (certain|sure)/i,
      /definitively (proven|verified)/i,
      /without (any )?doubt/i
    ];

    let hasStrongClaim = false;
    for (const pattern of strongClaimPatterns) {
      if (pattern.test(response)) {
        hasStrongClaim = true;
        break;
      }
    }

    if (hasStrongClaim && toolRuns && toolRuns.length < 3) {
      return {
        passed: false,
        reason: 'strong_claim_insufficient_evidence: high confidence claim with minimal tool support'
      };
    }

    return { passed: true, reason: 'claims_ok' };
  }
}

/**
 * Factory function
 */
export function createProofScorerCouncil(options) {
  return new ProofScorerCouncil(options);
}
