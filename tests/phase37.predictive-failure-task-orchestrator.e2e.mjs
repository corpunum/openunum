import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

const TEST_FILE = 'tmp/phase37-test.txt';
const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);

let proc;

try {
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(TEST_FILE, 'initial\n', 'utf8');

  proc = await startServer();

  console.log('=== Phase 37: Predictive Failure + Task Orchestrator E2E ===\n');

  // Test 1: Check predictive failures endpoint (should be empty initially)
  console.log('Test 1: Predictive failures endpoint (initial state)');
  const predInit = await jget('/api/autonomy/predictive-failures');
  assert.equal(predInit.status, 200);
  assert.equal(predInit.json.ok, true);
  assert(Array.isArray(predInit.json.predictions));
  console.log('  ✓ Predictive failures endpoint works\n');

  // Test 2: List tasks (should be empty initially)
  console.log('Test 2: Task orchestrator list (initial state)');
  const tasksInit = await jget('/api/autonomy/tasks?limit=10');
  assert.equal(tasksInit.status, 200);
  assert.equal(tasksInit.json.ok, true);
  assert(Array.isArray(tasksInit.json.tasks));
  console.log('  ✓ Task orchestrator list works\n');

  // Test 3: List workers (should be empty initially)
  console.log('Test 3: Worker orchestrator list (initial state)');
  const workersInit = await jget('/api/autonomy/workers?limit=10');
  assert.equal(workersInit.status, 200);
  assert.equal(workersInit.json.ok, true);
  assert(Array.isArray(workersInit.json.workers));
  console.log('  ✓ Worker orchestrator list works\n');

  // Test 4: Run a multi-step task via Task Orchestrator
  console.log('Test 4: Run multi-step task via Task Orchestrator');
  const taskRun = await jpost('/api/autonomy/tasks/run', {
    goal: 'Test Phase 37 task orchestrator with verification',
    plan: [
      'Inspect current state',
      'Apply mutation',
      'Verify change'
    ],
    steps: [
      {
        kind: 'tool',
        label: 'read test file',
        tool: 'file_read',
        args: { path: TEST_FILE }
      },
      {
        kind: 'tool',
        label: 'patch test file',
        tool: 'file_patch',
        args: {
          path: TEST_FILE,
          find: 'initial',
          replace: 'modified_phase37'
        }
      },
      {
        kind: 'tool',
        label: 'verify health',
        tool: 'http_request',
        args: { url: `http://127.0.0.1:${TEST_PORT}/api/health`, method: 'GET' }
      }
    ],
    verify: [
      { kind: 'step_ok', stepIndex: 0 },
      { kind: 'step_ok', stepIndex: 1 },
      { kind: 'file_contains', path: TEST_FILE, contains: 'modified_phase37' },
      { kind: 'http', url: `http://127.0.0.1:${TEST_PORT}/api/health`, expectStatus: 200 }
    ],
    monitor: [
      { kind: 'http', url: `http://127.0.0.1:${TEST_PORT}/api/runtime/inventory`, expectStatus: 200 }
    ]
  });

  assert.equal(taskRun.status, 200);
  assert.equal(taskRun.json.ok, true, `Task failed: ${JSON.stringify(taskRun.json)}`);
  assert.equal(taskRun.json.task.status, 'completed');
  assert.equal(taskRun.json.task.stepResults.length, 3);
  assert.equal(taskRun.json.task.verification.length, 4);
  assert.equal(taskRun.json.task.monitoring.length, 1);
  console.log(`  ✓ Task completed: ${taskRun.json.task.id}`);
  console.log(`  ✓ Steps: ${taskRun.json.task.stepResults.length}, Verifications: ${taskRun.json.task.verification.length}\n`);

  // Test 5: Get task status by ID
  console.log('Test 5: Get task status by ID');
  const taskStatus = await jget(`/api/autonomy/tasks/status?id=${encodeURIComponent(taskRun.json.task.id)}`);
  assert.equal(taskStatus.status, 200);
  assert.equal(taskStatus.json.ok, true);
  assert.equal(taskStatus.json.task.id, taskRun.json.task.id);
  console.log('  ✓ Task status retrieval works\n');

  // Test 6: Start a background worker
  console.log('Test 6: Start background worker');
  const workerStart = await jpost('/api/autonomy/workers/start', {
    name: 'phase37-test-worker',
    goal: 'Periodic health check',
    allowedTools: ['http_request'],
    steps: [
      {
        tool: 'http_request',
        args: { url: `http://127.0.0.1:${TEST_PORT}/api/health`, method: 'GET' }
      }
    ],
    maxStepsPerRun: 1,
    intervalMs: 5000,
    maxRuns: 3
  });

  assert.equal(workerStart.status, 200);
  assert.equal(workerStart.json.ok, true);
  assert.equal(workerStart.json.worker.status, 'scheduled');
  const workerId = workerStart.json.worker.id;
  console.log(`  ✓ Worker started: ${workerId}\n`);

  // Test 7: Get worker status
  console.log('Test 7: Get worker status');
  const workerStatus = await jget(`/api/autonomy/workers/status?id=${encodeURIComponent(workerId)}`);
  assert.equal(workerStatus.status, 200);
  assert.equal(workerStatus.json.ok, true);
  assert.equal(workerStatus.json.worker.id, workerId);
  console.log('  ✓ Worker status retrieval works\n');

  // Test 8: Tick worker manually
  console.log('Test 8: Tick worker manually');
  const workerTick = await jpost('/api/autonomy/workers/tick', { id: workerId });
  assert.equal(workerTick.status, 200);
  assert.equal(workerTick.json.ok, true);
  console.log('  ✓ Worker tick works\n');

  // Test 9: Stop worker
  console.log('Test 9: Stop worker');
  const workerStop = await jpost('/api/autonomy/workers/stop', { id: workerId });
  assert.equal(workerStop.status, 200);
  assert.equal(workerStop.json.ok, true);
  assert.equal(workerStop.json.worker.status, 'stopped');
  console.log('  ✓ Worker stopped\n');

  // Test 10: Verify file was modified
  console.log('Test 10: Verify file modification');
  const fileContent = fs.readFileSync(TEST_FILE, 'utf8');
  assert.equal(fileContent.trim(), 'modified_phase37');
  console.log('  ✓ File modification verified\n');

  // Test 11: Check predictive failures after task execution
  console.log('Test 11: Check predictive failures after task execution');
  const predAfter = await jget('/api/autonomy/predictive-failures');
  assert.equal(predAfter.status, 200);
  assert.equal(predAfter.json.ok, true);
  console.log(`  ✓ Predictions: ${predAfter.json.predictions.length}, Stats accuracy: ${predAfter.json.stats.accuracy}\n`);

  // Test 12: List tasks again (should include our completed task)
  console.log('Test 12: List tasks (should include completed task)');
  const tasksAfter = await jget('/api/autonomy/tasks?limit=10');
  assert.equal(tasksAfter.status, 200);
  assert.equal(tasksAfter.json.tasks.some(t => t.id === taskRun.json.task.id), true);
  console.log('  ✓ Task persistence verified\n');

  console.log('=== All Phase 37 Tests Passed ===');

} finally {
  await stopServer(proc);
  fs.rmSync(TEST_FILE, { force: true });
}

console.log('phase37.predictive-failure-task-orchestrator.e2e: ok');
