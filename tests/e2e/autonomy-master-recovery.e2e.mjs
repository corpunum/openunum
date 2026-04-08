import assert from 'node:assert/strict';
import { startServer, stopServer, jpost } from '../_helpers.mjs';

let proc;

try {
  proc = await startServer();

  const cycle = await jpost('/api/autonomy/master/cycle', {});
  assert.equal(cycle.status, 200);
  assert.equal(cycle.json.ok, true);
  assert.equal(typeof cycle.json.result, 'object');
  assert.equal(typeof cycle.json.result.health, 'object');

  const healthStatus = String(cycle.json.result.health?.status || 'unknown');
  assert.ok(['healthy', 'degraded'].includes(healthStatus));

  if (healthStatus === 'degraded') {
    const recovery = cycle.json.result.recovery;
    assert.equal(typeof recovery, 'object');
    assert.ok(Array.isArray(recovery.results));
    assert.ok(Array.isArray(recovery.actions));
  }

  console.log('autonomy master recovery e2e: ok');
} finally {
  await stopServer(proc);
}
