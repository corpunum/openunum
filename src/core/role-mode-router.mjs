/**
 * Role Mode Router
 * Lightweight classifier for bounded execution modes:
 * - intent
 * - execution
 * - proof
 * - repair
 * - retrieval
 */

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RULES = [
  { mode: 'proof', patterns: ['verify', 'prove', 'evidence', 'validate', 'test results', 'did you test', 'show output'] },
  { mode: 'repair', patterns: ['failed', 'error', 'fix', 'repair', 'recover', 'broken', 'not working', 'tool_circuit_open'] },
  { mode: 'retrieval', patterns: ['search', 'look up', 'find docs', 'read docs', 'latest', 'web', 'news', 'current'] },
  { mode: 'execution', patterns: ['implement', 'build', 'update', 'create', 'edit', 'refactor', 'run tests', 'ship'] },
  { mode: 'intent', patterns: ['plan', 'debate', 'brainstorm', 'what should we do', 'approach', 'strategy'] }
];

export function classifyRoleMode({ message = '', hasFailures = false, toolRuns = 0 } = {}) {
  const text = normalize(message);
  if (!text) return { mode: 'intent', reason: 'empty_message' };
  if (hasFailures) return { mode: 'repair', reason: 'failure_context' };
  if (toolRuns > 0 && /done|complete|finished|verified/.test(text)) {
    return { mode: 'proof', reason: 'post_execution_validation' };
  }
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => text.includes(pattern))) {
      return { mode: rule.mode, reason: `keyword:${rule.mode}` };
    }
  }
  return { mode: 'execution', reason: 'default_execution' };
}

export function modeDirective(modeResult) {
  const mode = modeResult?.mode || 'execution';
  const directives = {
    intent: 'Clarify objective and constraints before tool actions.',
    execution: 'Prioritize concrete tool actions and verifiable progress.',
    proof: 'Validate claims with explicit evidence before concluding.',
    repair: 'Prioritize diagnosis, rollback-safe fixes, and recovery.',
    retrieval: 'Gather high-signal context first, then act.'
  };
  return `ROLE MODE: ${mode.toUpperCase()} — ${directives[mode] || directives.execution}`;
}
