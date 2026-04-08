import assert from 'node:assert/strict';
import { startServer, stopServer, jpost } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);

let proc;

try {
  proc = await startServer();

  const runtimeGoal = await jpost('/api/autonomy/tasks/plan', {
    goal: 'search online for runtime health, inspect the host, and report proof',
    baseUrl: `http://127.0.0.1:${TEST_PORT}`
  });
  assert.equal(runtimeGoal.status, 200);
  assert.equal(runtimeGoal.json.ok, true);
  assert.equal(Array.isArray(runtimeGoal.json.payload.steps), true);
  assert.equal(runtimeGoal.json.payload.steps.some((step) => step.kind === 'tool' && step.tool === 'browser_search'), true);
  assert.equal(runtimeGoal.json.payload.steps.some((step) => step.kind === 'tool' && step.tool === 'http_request'), true);
  assert.equal(runtimeGoal.json.payload.steps.at(-1).kind, 'mission');
  assert.equal(Boolean(runtimeGoal.json.payload.sessionId), true);

  const codeGoal = await jpost('/api/autonomy/tasks/plan', {
    goal: 'inspect the repo, fix a backend bug, and verify the result'
  });
  assert.equal(codeGoal.status, 200);
  assert.equal(codeGoal.json.ok, true);
  assert.equal(codeGoal.json.payload.steps.some((step) => step.kind === 'tool' && step.tool === 'shell_run'), true);
  assert.equal(codeGoal.json.payload.steps.at(-1).kind, 'mission');

  console.log('phase24.goal-task-planner.e2e: ok');
} finally {
  await stopServer(proc);
}
