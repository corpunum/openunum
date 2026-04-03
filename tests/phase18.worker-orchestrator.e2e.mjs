import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();

  const started = await jpost('/api/autonomy/workers/start', {
    name: 'phase18-worker',
    goal: 'verify worker orchestration',
    allowedTools: ['shell_run'],
    steps: [
      { tool: 'shell_run', args: { cmd: 'uname -s' } }
    ],
    delayMs: 0,
    maxRuns: 1
  });
  assert.equal(started.status, 200);
  assert.equal(started.json.ok, true);
  assert.equal(Boolean(started.json.worker?.id), true);
  const workerId = started.json.worker.id;

  const listed = await jget('/api/autonomy/workers?limit=20');
  assert.equal(listed.status, 200);
  assert.equal(listed.json.ok, true);
  assert.equal(Array.isArray(listed.json.workers), true);
  assert.equal(listed.json.workers.some((w) => w.id === workerId), true);

  const ticked = await jpost('/api/autonomy/workers/tick', { id: workerId });
  assert.equal(ticked.status, 200);
  assert.equal(ticked.json.ok, true);
  assert.equal(Boolean(ticked.json.execution), true);

  const status = await jget(`/api/autonomy/workers/status?id=${encodeURIComponent(workerId)}`);
  assert.equal(status.status, 200);
  assert.equal(status.json.ok, true);
  assert.equal(status.json.worker.id, workerId);
  assert.equal(['completed', 'scheduled', 'running'].includes(status.json.worker.status), true);
  assert.equal(status.json.worker.runCount >= 1, true);
  assert.equal(Array.isArray(status.json.worker.logs), true);
  assert.equal(status.json.worker.logs.length >= 1, true);

  const badStart = await jpost('/api/autonomy/workers/start', {
    name: 'bad-worker',
    allowedTools: ['shell_run'],
    steps: [
      { tool: 'file_write', args: { path: 'x', content: 'x' } }
    ]
  });
  assert.equal(badStart.status, 400);
  assert.equal(badStart.json.ok, false);

  const stopped = await jpost('/api/autonomy/workers/stop', { id: workerId });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.ok, true);
  assert.equal(stopped.json.worker.status, 'stopped');

  console.log('phase18.worker-orchestrator.e2e: ok');
} finally {
  await stopServer(proc);
}
