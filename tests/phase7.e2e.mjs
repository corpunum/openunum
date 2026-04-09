import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

const p = await startServer();
try {
  const start = await jpost('/api/missions/start', {
    goal: 'Create a short mission update and stop',
    maxSteps: 1,
    intervalMs: 10
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

  const schedule = await jpost('/api/missions/schedule', {
    goal: 'scheduled phase7 mission',
    delayMs: 60000,
    enabled: false,
    maxSteps: 1
  });
  assert.equal(schedule.status, 200);
  assert.equal(schedule.json.ok, true);
  assert.ok(schedule.json.schedule?.id);

  const schedules = await jget('/api/missions/schedules?limit=10');
  assert.equal(schedules.status, 200);
  assert.ok(Array.isArray(schedules.json.schedules));
  assert.equal(
    schedules.json.schedules.some((item) => item.id === schedule.json.schedule.id),
    true
  );

  const updateSchedule = await jpost('/api/missions/schedule/update', {
    id: schedule.json.schedule.id,
    enabled: true
  });
  assert.equal(updateSchedule.status, 200);
  assert.equal(updateSchedule.json.ok, true);
  assert.equal(updateSchedule.json.schedule.enabled, true);

  console.log('phase7 ok');
} finally {
  await stopServer(p);
}
