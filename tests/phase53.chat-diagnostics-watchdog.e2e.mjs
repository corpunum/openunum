import assert from 'node:assert/strict';
import { startServer, stopServer, jget } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();

  const diagnostics = await jget('/api/chat/diagnostics');
  assert.equal(diagnostics.status, 200);
  assert.equal(diagnostics.json?.ok, true);
  assert.equal(typeof diagnostics.json?.pendingCount, 'number');
  assert.equal(typeof diagnostics.json?.stuckCount, 'number');
  assert.equal(typeof diagnostics.json?.oldestAgeMs, 'number');
  assert.equal(typeof diagnostics.json?.thresholds?.hardTimeoutMs, 'number');
  assert.equal(typeof diagnostics.json?.thresholds?.pendingStuckMs, 'number');

  const status = await jget('/api/autonomy/master/status');
  assert.equal(status.status, 200);
  assert.equal(status.json?.ok, true);
  assert.equal(typeof status.json?.status?.pendingQueue?.pendingCount, 'number');
  assert.equal(typeof status.json?.status?.pendingQueue?.stuckCount, 'number');
  assert.ok(Array.isArray(status.json?.status?.pendingQueue?.stuckSessions));

  console.log('phase53.chat-diagnostics-watchdog.e2e: ok');
} finally {
  await stopServer(proc);
}

