import assert from 'node:assert/strict';
import { classifyControllerBehavior } from '../src/core/model-behavior-registry.mjs';
import { buildControllerSystemMessage } from '../src/core/context-pack-builder.mjs';
import { continuationDirective, shouldForceContinuation } from '../src/core/execution-contract.mjs';
import { defaultConfig } from '../src/config.mjs';

const config = defaultConfig();

const behavior = classifyControllerBehavior({
  provider: 'ollama',
  model: 'ollama/qwen3.5-9b-uncensored-aggressive:latest',
  config
});
assert.ok(behavior.classId, 'behavior class should be assigned');
assert.ok(Number.isFinite(behavior.tuning.turnBudgetMs), 'behavior turn budget should be numeric');

const profile = {
  name: 'test-profile',
  guidance: ['g1'],
  guardrails: ['r1'],
  verificationHints: ['v1']
};
const msg = buildControllerSystemMessage({
  config,
  executionProfile: profile,
  behavior,
  provider: 'ollama',
  model: 'ollama/qwen3.5-9b-uncensored-aggressive:latest',
  routedTools: [{ tool: 'shell_run', score: 2 }]
});
assert.ok(msg.includes('Behavior class:'), 'system context pack should include behavior class');
assert.ok(msg.includes('Execution profile:'), 'system context pack should include execution profile');

const force = shouldForceContinuation({
  assistantText: 'I will plan first and then do it',
  toolCalls: [],
  toolRuns: 1,
  iteration: 1,
  maxIters: 4,
  priorForcedCount: 0
});
assert.equal(force, true, 'planner-like text should force continuation after tool work');
assert.ok(continuationDirective('test').includes('Execution contract reminder'), 'continuation directive should be generated');

console.log('phase14 controller behavior checks passed');
