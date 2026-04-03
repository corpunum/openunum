import assert from 'node:assert/strict';
import { resolveExecutionEnvelope } from '../src/core/model-execution-envelope.mjs';

const cloudQwen = resolveExecutionEnvelope({
  provider: 'ollama',
  model: 'qwen3.5:397b-cloud',
  runtime: {}
});
assert.equal(cloudQwen.tier, 'full');
assert.equal(cloudQwen.toolAllowlist, null);

const localQwen = resolveExecutionEnvelope({
  provider: 'ollama',
  model: 'qwen3.5:9b',
  runtime: {}
});
assert.equal(localQwen.tier, 'compact');

const hugeToken = resolveExecutionEnvelope({
  provider: 'ollama',
  model: 'model-128b-experimental',
  runtime: {}
});
assert.notEqual(hugeToken.tier, 'compact');

console.log('phase26.execution-envelope-tier.e2e: ok');
