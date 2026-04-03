import assert from 'node:assert/strict';
import { normalizeRecoveredFinalText, synthesizeToolOnlyAnswer } from '../src/core/turn-recovery-summary.mjs';

const userMessage = "we are already have some in your code ? don't we ?";
const executedTools = [
  {
    name: 'file_read',
    result: {
      ok: true,
      path: '/home/corp-unum/openunum/docs/research/hf_dataset_exploration_2026-04-03.md',
      content: '# Hugging Face Dataset Exploration (2026-04-03)\n\n- Queries: 8\n- Candidate set (deduped): 18\n'
    }
  },
  {
    name: 'file_read',
    result: {
      ok: true,
      path: '/home/corp-unum/openunum/data/hf-pilot/manifest.json',
      content: '{"stats":{"selectedDatasets":5,"totalNormalized":52}}'
    }
  }
];

const weakFinal = 'Let me properly explore the codebase for any existing datasets or training data:';
const recovered = synthesizeToolOnlyAnswer({ userMessage, executedTools, toolRuns: executedTools.length });
const normalized = normalizeRecoveredFinalText({
  finalText: weakFinal,
  userMessage,
  executedTools,
  toolRuns: executedTools.length
});

assert.equal(normalized, recovered);
assert.match(normalized, /^Status: /m);
assert.match(normalized, /Findings:/);
assert.match(normalized, /Provenance: synthesized from 1 tool surface\(s\): file_read\./);

console.log('phase34.preface-only-final-recovery.e2e: ok');
