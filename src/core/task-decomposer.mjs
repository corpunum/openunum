/**
 * TaskDecomposer — Break complex tasks into explicit numbered steps
 * Model-agnostic: pattern-based, no model inference needed
 */

const DECOMPOSITION_PATTERNS = [
  {
    regex: /(spot the difference|find .*differences?).*(html|web page|page|game)|\b(html|web page|page|game).*(spot the difference|differences?)/i,
    steps: [
      'Create the HTML structure and styling for side-by-side scenes.',
      'Implement scene rendering with intentional visual differences.',
      'Add click detection and difference hit validation.',
      'Track progress counters and completion state.',
      'Implement next-level progression and restart flow.',
      'Verify the page loads and interactions work end to end.'
    ]
  },
  { regex: /read.*and.*write|read.*then.*modify|read.*edit/i, steps: ['Read the file', 'Modify content', 'Write changes', 'Verify changes'] },
  { regex: /find.*and.*replace|search.*and.*update|search.*replace/i, steps: ['Search for pattern', 'Replace matches', 'Verify replacements'] },
  { regex: /install.*and.*configure|install.*then.*config/i, steps: ['Install package', 'Configure settings', 'Verify installation'] },
  { regex: /create.*and.*test|create.*then.*verify/i, steps: ['Create artifact', 'Run tests', 'Verify results'] },
  { regex: /list.*and.*filter|list.*then.*sort/i, steps: ['Get list', 'Apply filter/sort', 'Present results'] },
  { regex: /download.*and.*extract|download.*then.*unpack/i, steps: ['Download file', 'Extract contents', 'Verify extraction'] },
  { regex: /build.*and.*deploy|build.*then.*ship/i, steps: ['Build artifact', 'Run tests', 'Deploy', 'Verify deployment'] },
  { regex: /connect.*and.*query|connect.*then.*fetch/i, steps: ['Establish connection', 'Execute query', 'Process results'] },
];

const VERB_STEP_MAP = {
  read: 'Inspect the current implementation.',
  write: 'Implement the requested changes.',
  create: 'Create the requested artifact.',
  delete: 'Remove the targeted artifact safely.',
  install: 'Install required dependencies.',
  configure: 'Apply the required configuration.',
  test: 'Run tests for the changed surface.',
  run: 'Run the relevant command or workflow.',
  check: 'Check runtime and contract signals.',
  list: 'List available candidates or state entries.',
  find: 'Locate the required file or symbol.',
  update: 'Update existing implementation details.',
  modify: 'Adjust logic to match requirements.',
  deploy: 'Deploy changes to the target environment.',
  build: 'Build the requested output.',
  download: 'Download the required artifact.',
  extract: 'Extract and stage the artifact.',
  connect: 'Establish the required connection.',
  fetch: 'Fetch the requested data.',
  send: 'Send the required payload.',
  receive: 'Receive and inspect the response.',
  parse: 'Parse the returned data structure.',
  format: 'Format output for the target consumer.',
  convert: 'Convert content to the target format.',
  transform: 'Transform data to the required shape.',
  validate: 'Validate behavior against requirements.',
  verify: 'Verify the final state with concrete proof.'
};

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
    // Avoid overly generic decomposition on long prompts with weak signal.
    if (unique.length > 5) return { decomposed: false, steps: [], original: message };
    const mapped = unique
      .map((verb) => VERB_STEP_MAP[verb])
      .filter(Boolean);
    if (!mapped.length) return { decomposed: false, steps: [], original: message };
    return {
      decomposed: true,
      steps: mapped,
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
