import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

const TASK_FILE = 'tmp/phase22-task.txt';
const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);

let proc;

try {
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(TASK_FILE, 'alpha\n', 'utf8');

  proc = await startServer();

  const run = await jpost('/api/autonomy/tasks/run', {
    goal: 'run a generic multi-step task with verification and monitoring',
    plan: [
      'Inspect host state',
      'Apply one bounded mutation',
      'Verify and monitor'
    ],
    steps: [
      {
        kind: 'tool',
        label: 'inspect host',
        tool: 'shell_run',
        args: { cmd: 'uname -a' }
      },
      {
        kind: 'self_edit',
        label: 'patch file',
        payload: {
          label: 'phase22-self-edit',
          goal: 'patch a test file',
          edits: [
            {
              tool: 'file_patch',
              args: {
                path: TASK_FILE,
                find: 'alpha',
                replace: 'beta'
              }
            }
          ],
          validationCommands: ['node -e "process.exit(0)"'],
          canaryChecks: []
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
      { kind: 'file_contains', path: TASK_FILE, contains: 'beta' },
      { kind: 'http', url: `http://127.0.0.1:${TEST_PORT}/api/health`, expectStatus: 200 }
    ],
    monitor: [
      { kind: 'http', url: `http://127.0.0.1:${TEST_PORT}/api/runtime/inventory`, expectStatus: 200 },
      { kind: 'fact_exists', key: 'runtime.last_self_edit_status', valueIncludes: 'promoted' }
    ]
  });

  assert.equal(run.status, 200);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.task.status, 'completed');
  assert.equal(run.json.task.stepResults.length, 3);
  assert.equal(run.json.task.verification.length, 3);
  assert.equal(run.json.task.monitoring.length, 2);
  assert.equal(run.json.task.plan.every((item) => item.status === 'completed'), true);
  assert.equal(fs.readFileSync(TASK_FILE, 'utf8'), 'beta\n');

  const status = await jget(`/api/autonomy/tasks/status?id=${encodeURIComponent(run.json.task.id)}`);
  assert.equal(status.status, 200);
  assert.equal(status.json.ok, true);
  assert.equal(status.json.task.id, run.json.task.id);

  const listed = await jget('/api/autonomy/tasks?limit=10');
  assert.equal(listed.status, 200);
  assert.equal(listed.json.ok, true);
  assert.equal(listed.json.tasks.some((item) => item.id === run.json.task.id), true);

  console.log('phase22.generic-task-orchestrator.e2e: ok');
} finally {
  await stopServer(proc);
  fs.rmSync(TASK_FILE, { force: true });
}
