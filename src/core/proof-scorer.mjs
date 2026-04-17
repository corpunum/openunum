/**
 * Proof Scorer v2 — Multi-Factor Validation
 * 
 * Validates completion claims against tool evidence with enhanced scoring:
 * - Tool success ratio (0.25 weight)
 * - Output substance (0.20 weight)
 * - Goal alignment (0.20 weight)
 * - Error absence (0.15 weight)
 * - Verification depth (0.10 weight)
 * - Claim specificity (0.10 weight)
 * 
 * Threshold for "done": 0.6 (raised from 0.5)
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
 * Score verification depth — did the agent actually verify results?
 * @param {string} assistantText 
 * @param {Array} toolRuns 
 * @returns {{score: number, evidence: string[]}}
 */
function scoreVerificationDepth(assistantText, toolRuns) {
  const text = normalize(assistantText);
  let score = 0;
  const evidence = [];
  
  // Check for verification language
  const verificationPatterns = [
    /verified|confirmed|validated|checked|tested/i,
    /output shows|result shows|evidence shows/i,
    /as expected|as shown|as verified/i,
    /git (?:log|status|diff)|git show/i,
    /cat |head |tail |grep |ls -la/i,
    /test.*pass|pass.*test/i
  ];
  
  let matchCount = 0;
  for (const pattern of verificationPatterns) {
    if (pattern.test(text)) {
      matchCount++;
    }
  }
  
  // Score based on verification indicators
  if (matchCount >= 3) {
    score = 1.0;
    evidence.push('strong_verification');
  } else if (matchCount >= 2) {
    score = 0.7;
    evidence.push('moderate_verification');
  } else if (matchCount >= 1) {
    score = 0.4;
    evidence.push('weak_verification');
  } else {
    score = 0.1;
    evidence.push('no_verification');
  }
  
  // Bonus for actually reading back results
  if (/according to|from the output|the (?:result|output) indicates/i.test(text)) {
    score = Math.min(1.0, score + 0.15);
    evidence.push('result_interpretation');
  }
  
  return { score, evidence };
}

/**
 * Score claim specificity — are claims concrete and falsifiable?
 * @param {string} assistantText 
 * @returns {{score: number, evidence: string[]}}
 */
function scoreClaimSpecificity(assistantText) {
  const text = String(assistantText || '');
  let score = 0;
  const evidence = [];
  
  // Concrete evidence markers
  const specificityMarkers = [
    { pattern: /[a-f0-9]{7,40}/, label: 'git_hash' },           // Git commits
    { pattern: /\/[\w./-]+\.[\w]+/, label: 'file_path' },        // File paths
    { pattern: /\d+\/\d+/, label: 'test_ratio' },                // Test counts
    { pattern: /line \d+|lines \d+ to \d+/i, label: 'line_nums' }, // Line numbers
    { pattern: /bytes|characters|words/i, label: 'size_metric' },  // Size metrics
    { pattern: /http[s]?:\/\/[\w./-]+/, label: 'url' },          // URLs
    { pattern: /`[^`]+`|"[^"]+"/, label: 'quoted_value' }        // Quoted values
  ];
  
  let foundCount = 0;
  const foundMarkers = [];
  
  for (const { pattern, label } of specificityMarkers) {
    if (pattern.test(text)) {
      foundCount++;
      foundMarkers.push(label);
    }
  }
  
  if (foundCount >= 4) {
    score = 1.0;
    evidence.push(`highly_specific (${foundMarkers.join(', ')})`);
  } else if (foundCount >= 2) {
    score = 0.6;
    evidence.push(`moderately_specific (${foundMarkers.join(', ')})`);
  } else if (foundCount >= 1) {
    score = 0.3;
    evidence.push(`low_specificity (${foundMarkers.join(', ')})`);
  } else {
    score = 0.1;
    evidence.push('vague_claims');
  }
  
  // Penalty for vague language
  const vaguePatterns = [/should work|probably|might|maybe|seems like|appears to/i];
  for (const pattern of vaguePatterns) {
    if (pattern.test(text)) {
      score = Math.max(0, score - 0.15);
      evidence.push('vague_language_penalty');
      break;
    }
  }
  
  return { score, evidence };
}

/**
 * Score proof quality from assistant text and tool evidence.
 * Returns { score: 0..1, evidence: string[], confident: bool, breakdown: object }
 * 
 * Threshold for "done": 0.6 (raised from 0.5)
 */
export function scoreProofQuality({ assistantText, toolRuns, taskGoal }) {
  const breakdown = {};
  const evidence = [];
  let score = 0;

  const runs = Array.isArray(toolRuns) ? toolRuns : [];
  const text = String(assistantText || '');

  // 1. Tool success ratio (0.25 weight)
  const successfulTools = runs.filter(r => r && r.ok !== false && (r.ok === true || r.code === 0 || r.result !== undefined));
  const toolSuccessRatio = runs.length > 0 ? successfulTools.length / runs.length : 0;
  breakdown.toolSuccess = { weight: 0.25, ratio: toolSuccessRatio, earned: 0.25 * toolSuccessRatio };
  score += breakdown.toolSuccess.earned;
  if (toolSuccessRatio === 1 && runs.length > 0) {
    evidence.push('all_tools_succeeded');
  } else if (toolSuccessRatio > 0) {
    evidence.push(`${successfulTools.length}/${runs.length}_tools_ok`);
  }

  // 2. Output substance (0.20 weight) - substantial output from tools
  const outputLens = runs.map(r => {
    const parts = [r.stdout, r.result, r.body, r.text];
    return parts.reduce((len, p) => len + (p ? String(p).length : 0), 0);
  });
  const maxOutput = Math.max(0, ...outputLens);
  const hasSubstantial = maxOutput > 100; // Raised threshold
  const outputScore = hasSubstantial ? 0.20 : (maxOutput > 20 ? 0.10 : 0.05);
  breakdown.outputSubstance = { weight: 0.20, maxChars: maxOutput, earned: outputScore };
  score += outputScore;
  if (hasSubstantial) evidence.push('substantial_output');
  else if (maxOutput > 0) evidence.push('minimal_output');

  // 3. Goal alignment (0.20 weight) - tool outputs mention goal keywords
  const goalWords = extractGoalKeywords(taskGoal);
  if (goalWords.length > 0) {
    const allToolText = runs.map(r => JSON.stringify(r || {}).toLowerCase()).join(' ');
    const matchedWords = goalWords.filter(w => allToolText.includes(w));
    const alignment = matchedWords.length / goalWords.length;
    breakdown.goalAlignment = { weight: 0.20, matched: matchedWords.length, total: goalWords.length, earned: 0.20 * alignment };
    score += breakdown.goalAlignment.earned;
    if (alignment > 0.5) evidence.push(`goal_aligned_${matchedWords.length}_${goalWords.length}`);
  } else {
    breakdown.goalAlignment = { weight: 0.20, earned: 0.10, note: 'no_goal_keywords' };
    score += 0.10; // neutral if no goal specified
  }

  // 4. No error signals (0.15 weight)
  const errorRuns = runs.filter(r => r && (r.ok === false || (r.code !== undefined && r.code !== 0) || r.stderr));
  const noErrors = errorRuns.length === 0;
  breakdown.noErrors = { weight: 0.15, errorCount: errorRuns.length, earned: noErrors ? 0.15 : 0 };
  score += breakdown.noErrors.earned;
  if (noErrors && runs.length > 0) evidence.push('no_errors');
  else if (errorRuns.length > 0) evidence.push(`${errorRuns.length}_errors_detected`);

  // 5. Verification depth (0.10 weight) - NEW
  const verificationResult = scoreVerificationDepth(text, runs);
  breakdown.verificationDepth = { weight: 0.10, score: verificationResult.score, earned: 0.10 * verificationResult.score };
  score += breakdown.verificationDepth.earned;
  evidence.push(...verificationResult.evidence);

  // 6. Claim specificity (0.10 weight) - NEW
  const specificityResult = scoreClaimSpecificity(text);
  breakdown.claimSpecificity = { weight: 0.10, score: specificityResult.score, earned: 0.10 * specificityResult.score };
  score += breakdown.claimSpecificity.earned;
  evidence.push(...specificityResult.evidence);

  const finalScore = Math.min(Math.max(score, 0), 1);
  
  // Raised threshold: 0.6 instead of 0.5
  const DONE_THRESHOLD = 0.6;
  const confident = finalScore >= DONE_THRESHOLD;

  return {
    score: Math.round(finalScore * 1000) / 1000,
    overallScore: Math.round(finalScore * 1000) / 1000,
    confident,
    evidence,
    breakdown,
    toolCount: runs.length,
    threshold: DONE_THRESHOLD,
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

/**
 * Get detailed breakdown for debugging
 */
export function getProofBreakdown({ assistantText, toolRuns, taskGoal }) {
  const result = scoreProofQuality({ assistantText, toolRuns, taskGoal });
  return {
    ...result,
    interpretation: {
      done: result.confident,
      needsMoreWork: !result.confident,
      missingFactors: Object.entries(result.breakdown)
        .filter(([_, v]) => v.earned < v.weight * 0.5)
        .map(([k, _]) => k)
    }
  };
}
