import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

const p = await startServer();
try {
  const start = await jpost('/api/missions/start', {
    goal: 'Create a short mission update and stop',
    maxSteps: 1,
    intervalMs: 0
  });
  assert.equal(start.status, 200);
  assert.ok(start.json.id);

  const status = await jget(`/api/missions/status?id=${encodeURIComponent(start.json.id)}`);
  assert.equal(status.status, 200);
  assert.equal(status.json.mission.id, start.json.id);

  const stop = await jpost('/api/missions/stop', { id: start.json.id });
  assert.equal(stop.status, 200);
  assert.equal(stop.json.ok, true);

  const list = await jget('/api/missions');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.missions));

  console.log('phase7 ok');
} finally {
  await stopServer(p);
}
