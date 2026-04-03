import assert from 'node:assert/strict';
import { normalizeRecoveredFinalText, synthesizeToolOnlyAnswer } from '../src/core/turn-recovery-summary.mjs';

const userMessage = 'can you check huggingface usable datasets for model/agent training to improve tool calling/execution and planner/tasks data to test openunum and compare?';
const executedTools = [
  {
    name: 'browser_search',
    result: { ok: false, error: 'fetch failed', attempts: 6 }
  },
  {
    name: 'http_request',
    result: {
      ok: true,
      url: 'https://huggingface.co/api/datasets?search=agent+tool+calling&limit=20',
      json: [
        {
          id: 'alwaysfurther/deepfabric-agent-tool-calling',
          downloads: 51,
          likes: 0,
          tags: ['deepfabric', 'synthetic'],
          description: 'Examples of AI Agent Tool calling'
        },
        {
          id: 'DataCreatorAI/tool-calling-browser-agent-tasks',
          downloads: 48,
          likes: 1,
          tags: ['tool-calling', 'agentic-tasks', 'browser-tasks', 'function-calling', 'llm-training', 'synthetic-data'],
          description: 'Tool Calling for Agentic Tasks with Multi-Step Workflows contains 1,062 synthetic multi-turn conversations.'
        }
      ]
    }
  },
  {
    name: 'http_request',
    result: {
      ok: true,
      url: 'https://huggingface.co/api/datasets?search=agent+planner+task&limit=20',
      json: []
    }
  }
];

const synthesized = synthesizeToolOnlyAnswer({
  userMessage,
  executedTools,
  toolRuns: executedTools.length
});

assert.match(synthesized, /Usable Hugging Face datasets found for this ask:/);
assert.match(synthesized, /DataCreatorAI\/tool-calling-browser-agent-tasks/);
assert.match(synthesized, /pilot=selected/);
assert.match(synthesized, /Comparison:/);
assert.match(synthesized, /best tool-calling fit:/);
assert.match(synthesized, /best planner\/tasks fit:/);
assert.match(synthesized, /Recommendation:/);
assert.match(synthesized, /Provenance: synthesized from 2 tool surface\(s\): browser_search, http_request\./);
assert.ok(synthesized.length < 3500);

const weak = `Status: partial\nFindings:\n- browser_search: {"ok":false}\n- http_request: {"ok":true,"jsonSummary":"array(2)"}`;
const normalized = normalizeRecoveredFinalText({
  finalText: weak,
  userMessage,
  executedTools,
  toolRuns: executedTools.length
});
assert.equal(normalized, synthesized);

console.log('phase30.research-answer-shaping.e2e: ok');
