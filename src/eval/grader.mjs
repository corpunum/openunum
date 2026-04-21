/**
 * Eval Grader
 *
 * Scores eval results using multiple grading modes:
 * - exact_sequence: exact tool call order match
 * - exact_set: exact tool set match (order-independent)
 * - ordered_subsequence: expected sequence is a subsequence of actual
 * - required_tools: all expected tools present (may have extras)
 * - forbidden_tools: none of the forbidden tools used
 * - final_state: proof/verifier score + final answer quality
 * - proof_score: OpenUnum's built-in proof scorer
 * - semantic: LLM-judge semantic similarity (fallback)
 *
 * Each mode returns { score: 0-1, details: string, mode: string }
 */

/**
 * Grade an eval result using the specified mode.
 * Returns an array of { mode, score, details } for all applicable modes.
 */
export function gradeEvalResult({ expected = {}, actual = {}, mode = 'all' } = {}) {
  const modes = mode === 'all'
    ? ['exact_sequence', 'exact_set', 'ordered_subsequence', 'required_tools', 'forbidden_tools', 'final_state', 'proof_score']
    : [mode];

  const results = [];
  for (const m of modes) {
    const grader = GRADERS[m];
    if (!grader) continue;
    try {
      const result = grader(expected, actual);
      results.push({ mode: m, ...result });
    } catch (error) {
      results.push({ mode: m, score: 0, details: `grader_error: ${error.message}` });
    }
  }
  return results;
}

/**
 * Compute an overall grade score from individual mode results.
 * Weighted combination: required_tools and forbidden_tools are prerequisites,
 * proof_score and final_state are quality signals, sequence matching is bonus.
 */
export function computeOverallGrade(modeResults) {
  if (!modeResults.length) return { score: 0, details: 'no_grading_modes' };

  const byMode = Object.fromEntries(modeResults.map(r => [r.mode, r]));

  // Required tools must be present (prerequisite)
  const requiredScore = byMode.required_tools?.score ?? 1;
  // Forbidden tools must not be present (prerequisite)
  const forbiddenScore = byMode.forbidden_tools?.score ?? 1;
  // If prerequisites fail, overall score is heavily penalized
  const prereq = Math.min(requiredScore, forbiddenScore);

  // Quality signals
  const proofScore = byMode.proof_score?.score ?? byMode.final_state?.score ?? 0.5;
  const sequence = byMode.ordered_subsequence?.score ?? byMode.exact_set?.score ?? 0;

  // Weighted: 40% proof/final state, 30% sequence matching, 30% prerequisites
  const raw = (proofScore * 0.4) + (sequence * 0.3) + (prereq * 0.3);

  return {
    score: Math.round(Math.min(1, raw) * 100) / 100,
    details: `prereq=${prereq.toFixed(2)} proof=${proofScore.toFixed(2)} seq=${sequence.toFixed(2)}`
  };
}

// --- Individual graders ---

const GRADERS = {
  exact_sequence: gradeExactSequence,
  exact_set: gradeExactSet,
  ordered_subsequence: gradeOrderedSubsequence,
  required_tools: gradeRequiredTools,
  forbidden_tools: gradeForbiddenTools,
  final_state: gradeFinalState,
  proof_score: gradeProofScore
};

function parseToolNames(toolCalls) {
  if (!toolCalls) return [];
  if (typeof toolCalls === 'string') {
    try { toolCalls = JSON.parse(toolCalls); } catch { return toolCalls.split(/[,\s]+/).filter(Boolean); }
  }
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map(t => typeof t === 'string' ? t : t?.name || '')
    .filter(Boolean);
}

function gradeExactSequence(expected, actual) {
  const expectedTools = parseToolNames(expected.tool_calls || expected.expected_tool_calls);
  const actualTools = parseToolNames(actual.tool_calls || actual.actual_tool_calls);

  if (!expectedTools.length && !actualTools.length) return { score: 1, details: 'empty_match' };
  if (!expectedTools.length) return { score: 0.5, details: 'no_expected_tools' };

  const maxLen = Math.max(expectedTools.length, actualTools.length);
  if (maxLen === 0) return { score: 1, details: 'empty_match' };

  let matches = 0;
  for (let i = 0; i < Math.min(expectedTools.length, actualTools.length); i++) {
    if (expectedTools[i] === actualTools[i]) matches++;
  }

  const score = matches / expectedTools.length;
  return { score: Math.round(score * 100) / 100, details: `${matches}/${expectedTools.length} exact sequence matches` };
}

function gradeExactSet(expected, actual) {
  const expectedSet = new Set(parseToolNames(expected.tool_calls || expected.expected_tool_calls));
  const actualSet = new Set(parseToolNames(actual.tool_calls || actual.actual_tool_calls));

  if (!expectedSet.size && !actualSet.size) return { score: 1, details: 'empty_set_match' };
  if (!expectedSet.size) return { score: 0.5, details: 'no_expected_tools' };

  let overlap = 0;
  for (const t of expectedSet) {
    if (actualSet.has(t)) overlap++;
  }

  const score = overlap / expectedSet.size;
  return { score: Math.round(score * 100) / 100, details: `${overlap}/${expectedSet.size} tools in set` };
}

function gradeOrderedSubsequence(expected, actual) {
  const expectedTools = parseToolNames(expected.tool_calls || expected.expected_tool_calls);
  const actualTools = parseToolNames(actual.tool_calls || actual.actual_tool_calls);

  if (!expectedTools.length) return { score: 0.5, details: 'no_expected_sequence' };

  let expectedIdx = 0;
  for (const actual of actualTools) {
    if (expectedIdx < expectedTools.length && actual === expectedTools[expectedIdx]) {
      expectedIdx++;
    }
  }

  const score = expectedIdx / expectedTools.length;
  return { score: Math.round(score * 100) / 100, details: `${expectedIdx}/${expectedTools.length} subsequence matches` };
}

function gradeRequiredTools(expected, actual) {
  const required = parseToolNames(expected.tool_calls || expected.expected_tool_calls);
  const actualSet = new Set(parseToolNames(actual.tool_calls || actual.actual_tool_calls));

  if (!required.length) return { score: 1, details: 'no_required_tools' };

  let present = 0;
  for (const t of required) {
    if (actualSet.has(t)) present++;
  }

  const score = present / required.length;
  return { score: Math.round(score * 100) / 100, details: `${present}/${required.length} required tools present` };
}

function gradeForbiddenTools(expected, actual) {
  const forbidden = (expected.forbidden_tools || []);
  if (!forbidden.length) return { score: 1, details: 'no_forbidden_tools' };

  const actualSet = new Set(parseToolNames(actual.tool_calls || actual.actual_tool_calls));
  const violations = forbidden.filter(t => actualSet.has(t));

  const score = Math.max(0, 1 - violations.length * 0.5);
  return { score: Math.round(score * 100) / 100, details: violations.length ? `${violations.length} forbidden tools used: ${violations.join(', ')}` : 'no forbidden tools used' };
}

function gradeFinalState(expected, actual) {
  const proofScore = actual.proof_score ?? actual.proofScore ?? 0;
  const verifierPassed = Boolean(actual.verifier_passed ?? actual.verifierPassed);
  const finalText = String(actual.final || actual.actual_final || '').trim();
  const expectedFinal = String(expected.final || expected.expected_final || '').trim();

  let textScore = 0;
  if (expectedFinal && finalText) {
    // Simple text overlap score
    const expectedTerms = new Set(expectedFinal.toLowerCase().split(/\s+/).filter(t => t.length > 3));
    const actualTerms = new Set(finalText.toLowerCase().split(/\s+/).filter(t => t.length > 3));
    if (expectedTerms.size > 0) {
      let overlap = 0;
      for (const t of expectedTerms) {
        if (actualTerms.has(t)) overlap++;
      }
      textScore = overlap / expectedTerms.size;
    } else {
      textScore = finalText ? 0.5 : 0;
    }
  } else if (finalText) {
    textScore = 0.3; // Has output but nothing to compare against
  }

  const verifierScore = verifierPassed ? 0.3 : 0;
  const score = Math.min(1, (proofScore * 0.5) + (textScore * 0.2) + verifierScore);
  return { score: Math.round(score * 100) / 100, details: `proof=${proofScore.toFixed(2)} text=${textScore.toFixed(2)} verifier=${verifierPassed}` };
}

function gradeProofScore(expected, actual) {
  const proofScore = actual.proof_score ?? actual.proofScore ?? 0;
  return { score: Math.round(proofScore * 100) / 100, details: `proof_score=${proofScore.toFixed(2)}` };
}
