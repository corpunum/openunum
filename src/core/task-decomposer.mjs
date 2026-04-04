/**
 * TaskDecomposer — Break complex tasks into explicit numbered steps
 * Model-agnostic: pattern-based, no model inference needed
 */

const DECOMPOSITION_PATTERNS = [
  { regex: /read.*and.*write|read.*then.*modify|read.*edit/i, steps: ['Read the file', 'Modify content', 'Write changes', 'Verify changes'] },
  { regex: /find.*and.*replace|search.*and.*update|search.*replace/i, steps: ['Search for pattern', 'Replace matches', 'Verify replacements'] },
  { regex: /install.*and.*configure|install.*then.*config/i, steps: ['Install package', 'Configure settings', 'Verify installation'] },
  { regex: /create.*and.*test|create.*then.*verify/i, steps: ['Create artifact', 'Run tests', 'Verify results'] },
  { regex: /list.*and.*filter|list.*then.*sort/i, steps: ['Get list', 'Apply filter/sort', 'Present results'] },
  { regex: /download.*and.*extract|download.*then.*unpack/i, steps: ['Download file', 'Extract contents', 'Verify extraction'] },
  { regex: /build.*and.*deploy|build.*then.*ship/i, steps: ['Build artifact', 'Run tests', 'Deploy', 'Verify deployment'] },
  { regex: /connect.*and.*query|connect.*then.*fetch/i, steps: ['Establish connection', 'Execute query', 'Process results'] },
];

/**
 * Decompose a user message into explicit steps
 * @param {string} message - User's task description
 * @returns {{ decomposed: boolean, steps: string[], original: string }}
 */
export function decomposeTask(message) {
  if (!message || typeof message !== 'string') {
    return { decomposed: false, steps: [], original: String(message) };
  }

  // Pattern matching
  for (const p of DECOMPOSITION_PATTERNS) {
    if (p.regex.test(message)) {
      return { decomposed: true, steps: p.steps, original: message };
    }
  }

  // Extract action verbs as fallback
  const verbs = message.match(/\b(read|write|create|delete|install|configure|test|run|check|list|find|update|modify|deploy|build|download|extract|connect|fetch|send|receive|parse|format|convert|transform|validate|verify)\b/gi);
  if (verbs && verbs.length > 1) {
    const unique = [...new Set(verbs.map(v => v.toLowerCase()))];
    return {
      decomposed: true,
      steps: unique.map(v => `Execute: ${v}`),
      original: message
    };
  }

  return { decomposed: false, steps: [], original: message };
}

/**
 * Format decomposition as numbered list
 */
export function formatDecomposition(result) {
  if (!result.decomposed) return '';

  const lines = ['Task decomposition:'];
  result.steps.forEach((step, i) => {
    lines.push(`  ${i + 1}. ${step}`);
  });
  return lines.join('\n');
}
