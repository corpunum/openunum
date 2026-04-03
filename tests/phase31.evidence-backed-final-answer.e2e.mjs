import assert from 'node:assert/strict';
import { normalizeRecoveredFinalText, synthesizeToolOnlyAnswer } from '../src/core/turn-recovery-summary.mjs';

const userMessage = 'can you check huggingface usable datasets for model/agent training to improve tool calling/execution and planner/tasks data to test openunum and compare?';
const executedTools = [
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
  }
];

const hallucinatedFinal = [
  'Here are the best datasets:',
  '1. DeepNLP/Agent-Tool-Use-Dialogue-Open-Dataset',
  '2. LangAGI-Lab/mini_rm_benchmark_for_web_agent',
  '3. alwaysfurther/deepfabric-agent-tool-calling'
].join('\n');

const normalized = normalizeRecoveredFinalText({
  finalText: hallucinatedFinal,
  userMessage,
  executedTools,
  toolRuns: 1
});
const recovered = synthesizeToolOnlyAnswer({ userMessage, executedTools, toolRuns: 1 });

assert.equal(normalized, recovered);
assert.ok(!normalized.includes('DeepNLP/Agent-Tool-Use-Dialogue-Open-Dataset'));
assert.ok(!normalized.includes('LangAGI-Lab/mini_rm_benchmark_for_web_agent'));
assert.ok(normalized.includes('alwaysfurther/deepfabric-agent-tool-calling'));
assert.ok(normalized.includes('DataCreatorAI/tool-calling-browser-agent-tasks'));

console.log('phase31.evidence-backed-final-answer.e2e: ok');
