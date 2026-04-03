import assert from 'node:assert/strict';
import { normalizeRecoveredFinalText, synthesizeToolOnlyAnswer } from '../src/core/turn-recovery-summary.mjs';

const userMessage = "we are already have some in your code ? don't we ?";
const executedTools = [
  {
    name: 'file_read',
    result: {
      ok: true,
      path: '/home/corp-unum/openunum/data/hf-pilot/manifest.json',
      content: '{"stats":{"selectedDatasets":5,"totalNormalized":52}}'
    }
  }
];

const weakFinal = [
  '<tool_call>',
  '<function=shell_run>',
  '<parameter=command>find /home/corp-unum/openunum -type f | head -30</parameter>',
  '</function>',
  '</tool_call>'
].join('\n');

const recovered = synthesizeToolOnlyAnswer({ userMessage, executedTools, toolRuns: executedTools.length });
const normalized = normalizeRecoveredFinalText({
  finalText: weakFinal,
  userMessage,
  executedTools,
  toolRuns: executedTools.length
});

assert.equal(normalized, recovered);
assert.match(normalized, /^Status: /m);
assert.match(normalized, /Provenance: synthesized from 1 tool surface\(s\): file_read\./);

console.log('phase35.tool-call-markup-recovery.e2e: ok');
