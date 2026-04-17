/**
 * CompletionChecklist — Track task steps and prevent premature "Done" declarations
 * Model-agnostic: works with any provider/model
 */

export class CompletionChecklist {
  constructor() {
    this.items = new Map();
    this.initialized = false;
  }

  reset() {
    this.items.clear();
    this.initialized = false;
  }

  initFromSteps(steps) {
    this.reset();
    steps.forEach((step, i) => {
      this.items.set(`step-${i}`, {
        description: step,
        status: 'pending',
        proof: null,
        timestamp: null
      });
    });
    this.initialized = true;
  }

  markComplete(stepId, proof) {
    const item = this.items.get(stepId);
    if (item) {
      item.status = 'complete';
      item.proof = proof;
      item.timestamp = Date.now();
      return true;
    }
    return false;
  }

  markFailed(stepId, reason) {
    const item = this.items.get(stepId);
    if (item) {
      item.status = 'failed';
      item.proof = reason;
      item.timestamp = Date.now();
      return true;
    }
    return false;
  }

  getRemaining() {
    return [...this.items.entries()]
      .filter(([_, item]) => item.status === 'pending')
      .map(([id, item]) => ({ id, description: item.description }));
  }

  getFailed() {
    return [...this.items.entries()]
      .filter(([_, item]) => item.status === 'failed')
      .map(([id, item]) => ({ id, description: item.description, reason: item.proof }));
  }

  isAllComplete() {
    if (!this.initialized || this.items.size === 0) return false;
    return [...this.items.values()].every(item => item.status === 'complete');
  }

  getProgress() {
    const total = this.items.size;
    const complete = [...this.items.values()].filter(i => i.status === 'complete').length;
    const failed = [...this.items.values()].filter(i => i.status === 'failed').length;
    return { 
      complete, 
      failed, 
      total, 
      percent: total > 0 ? Math.round(complete / total * 100) : 0,
      hasTask: this.initialized && total > 0
    };
  }

  toString() {
    const lines = [];
    for (const [id, item] of this.items) {
      const icon = item.status === 'complete' ? '✅' : item.status === 'failed' ? '❌' : '⬜';
      lines.push(`${icon} ${id}: ${item.description}`);
    }
    const progress = this.getProgress();
    lines.push(`\nProgress: ${progress.complete}/${progress.total} (${progress.percent}%)`);
    return lines.join('\n');
  }
}

const DETECT_STEP_MAP = {
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
  verify: 'Verify the final state with concrete proof.'
};

/**
 * Auto-detect steps from user message (simple pattern matching)
 */
export function detectSteps(message) {
  const patterns = [
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
    { regex: /read.*and.*write|read.*then.*modify/i, steps: ['Read the file', 'Modify content', 'Write changes'] },
    { regex: /find.*and.*replace|search.*and.*update/i, steps: ['Search for pattern', 'Replace matches', 'Verify changes'] },
    { regex: /install.*and.*configure/i, steps: ['Install package', 'Configure settings', 'Verify installation'] },
    { regex: /create.*and.*test/i, steps: ['Create artifact', 'Run tests', 'Verify results'] },
    { regex: /list.*and.*filter/i, steps: ['Get list', 'Apply filter', 'Present results'] },
  ];

  for (const p of patterns) {
    if (p.regex.test(message)) return p.steps;
  }

  // Extract action verbs
  const verbs = message.match(/\b(read|write|create|delete|install|configure|test|run|check|list|find|update|modify|deploy|build)\b/gi);
  if (verbs && verbs.length > 1) {
    const unique = [...new Set(verbs.map(v => v.toLowerCase()))];
    if (unique.length > 5) return null;
    const mapped = unique.map((verb) => DETECT_STEP_MAP[verb]).filter(Boolean);
    return mapped.length > 0 ? mapped : null;
  }

  return null;
}
