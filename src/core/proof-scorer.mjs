/**
 * Proof Scorer - Validates completion claims against tool evidence
 * Runs in shadow mode initially to validate scoring without changing behavior.
 */

function normalize(text) {
  return String(text || '').toLowerCase();
}

function extractGoalKeywords(taskGoal) {
  if (!taskGoal) return [];
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'for', 'on', 'with', 'and', 'or', 'but', 'not', 'this', 'that', 'it', 'as', 'by', 'from', 'at', 'do', 'does', 'did']);
  return normalize(taskGoal)
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

/**
 * Score proof quality from assistant text and tool evidence.
 * Returns { score: 0..1, evidence: string[], confident: bool, breakdown: object }
 */
export function scoreProofQuality({ assistantText, toolRuns, taskGoal }) {
  const breakdown = {};
  const evidence = [];
  let score = 0;

  const runs = Array.isArray(toolRuns) ? toolRuns : [];

  // 1. Tool success check (0.3 weight)
  const successfulTools = runs.filter(r => r && r.ok !== false && (r.ok === true || r.code === 0 || r.result !== undefined));
  const toolSuccessRatio = runs.length > 0 ? successfulTools.length / runs.length : 0;
  breakdown.toolSuccess = { weight: 0.3, ratio: toolSuccessRatio, earned: 0.3 * toolSuccessRatio };
  score += breakdown.toolSuccess.earned;
  if (toolSuccessRatio === 1 && runs.length > 0) evidence.push('all_tools_succeeded');
  else if (toolSuccessRatio > 0) evidence.push(`${successfulTools.length}/${runs.length}_tools_ok`);

  // 2. Output relevance (0.3 weight) - substantial output from tools
  const outputLens = runs.map(r => {
    const parts = [r.stdout, r.result, r.body, r.text];
    return parts.reduce((len, p) => len + (p ? String(p).length : 0), 0);
  });
  const maxOutput = Math.max(0, ...outputLens);
  const hasSubstantial = maxOutput > 50;
  const outputScore = hasSubstantial ? 0.3 : (maxOutput > 0 ? 0.15 : 0);
  breakdown.outputRelevance = { weight: 0.3, maxChars: maxOutput, earned: outputScore };
  score += outputScore;
  if (hasSubstantial) evidence.push('substantial_output');

  // 3. Goal alignment (0.2 weight) - tool outputs mention goal keywords
  const goalWords = extractGoalKeywords(taskGoal);
  if (goalWords.length > 0) {
    const allToolText = runs.map(r => JSON.stringify(r || {}).toLowerCase()).join(' ');
    const matchedWords = goalWords.filter(w => allToolText.includes(w));
    const alignment = matchedWords.length / goalWords.length;
    breakdown.goalAlignment = { weight: 0.2, matched: matchedWords.length, total: goalWords.length, earned: 0.2 * alignment };
    score += breakdown.goalAlignment.earned;
    if (alignment > 0.5) evidence.push(`goal_aligned_${matchedWords.length}_${goalWords.length}`);
  } else {
    breakdown.goalAlignment = { weight: 0.2, earned: 0.1, note: 'no_goal_keywords' };
    score += 0.1; // neutral if no goal specified
  }

  // 4. No error signals (0.2 weight)
  const errorRuns = runs.filter(r => r && (r.ok === false || (r.code !== undefined && r.code !== 0) || r.stderr));
  const noErrors = errorRuns.length === 0;
  breakdown.noErrors = { weight: 0.2, errorCount: errorRuns.length, earned: noErrors ? 0.2 : 0 };
  score += breakdown.noErrors.earned;
  if (noErrors && runs.length > 0) evidence.push('no_errors');

  const finalScore = Math.min(Math.max(score, 0), 1);

  return {
    score: Math.round(finalScore * 1000) / 1000,
    confident: finalScore >= 0.7,
    evidence,
    breakdown,
    toolCount: runs.length,
    timestamp: new Date().toISOString()
  };
}

/**
 * Compare shadow score against current decision.
 * Returns comparison object for logging.
 */
export function shadowCompare({ assistantText, toolRuns, taskGoal, currentDecision }) {
  const result = scoreProofQuality({ assistantText, toolRuns, taskGoal });
  result.currentDecision = currentDecision;
  result.wouldChange = result.confident !== currentDecision;
  return result;
}
