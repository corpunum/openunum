/**
 * ConfidenceScorer — Score agent confidence in outputs
 * Model-agnostic: rule-based scoring
 */

/**
 * Score confidence based on evidence quality
 * @param {string} action - What the agent claims to have done
 * @param {object} evidence - Available evidence
 * @returns {{ score: number, level: string, recommendation: string|null }}
 */
export function scoreConfidence(action, evidence = {}) {
  let score = 0.5; // Base confidence

  // Boost for concrete evidence
  if (evidence.toolResultOk) score += 0.2;
  if (evidence.fileExists) score += 0.15;
  if (evidence.httpSuccess) score += 0.15;
  if (evidence.dataReturned) score += 0.1;
  if (evidence.exitCodeZero) score += 0.1;
  if (evidence.multipleToolConfirmations) score += 0.1;

  // Reduce for uncertainty
  if (evidence.partialResult) score -= 0.2;
  if (evidence.timeout) score -= 0.3;
  if (evidence.ambiguous) score -= 0.15;
  if (evidence.noToolCalled) score -= 0.25;
  if (evidence.retriedMultipleTimes) score -= 0.1;
  if (evidence.emptyResult) score -= 0.2;

  // Cap between 0 and 1
  score = Math.max(0, Math.min(1, score));

  const level = score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low';
  const recommendation = score < 0.5
    ? '⚠️ Low confidence: Verify with another tool before declaring complete'
    : score < 0.8
      ? 'Consider additional verification'
      : null;

  return { score: Math.round(score * 100) / 100, level, recommendation };
}

/**
 * Score a "Done" claim specifically
 * @param {object} params - Evidence about the task
 * @returns {{ canClaimDone: boolean, score: number, blockers: string[] }}
 */
export function scoreDoneClaim(params = {}) {
  const blockers = [];
  let score = 0;

  // Required for "Done"
  if (params.allStepsComplete) score += 0.3; else blockers.push('Not all steps complete');
  if (params.hasProof) score += 0.3; else blockers.push('No proof provided');
  if (params.toolsSucceeded) score += 0.2; else blockers.push('Tool calls failed');
  if (params.noPendingActions) score += 0.2; else blockers.push('Pending actions remain');

  return {
    canClaimDone: blockers.length === 0 && score >= 0.8,
    score,
    blockers
  };
}

/**
 * Format confidence as text
 */
export function formatConfidence(result) {
  const icon = result.level === 'high' ? '✅' : result.level === 'medium' ? '⚠️' : '❌';
  const lines = [`${icon} Confidence: ${result.score} (${result.level})`];
  if (result.recommendation) lines.push(result.recommendation);
  return lines.join('\n');
}
