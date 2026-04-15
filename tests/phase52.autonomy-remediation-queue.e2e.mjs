import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();

  const initial = await jget('/api/autonomy/remediations');
  assert.equal(initial.status, 200);
  assert.equal(initial.json?.ok, true);
  assert.ok(Array.isArray(initial.json?.items));

  const created = await jpost('/api/autonomy/remediations/create', {
    title: 'phase52 remediation test',
    source: 'e2e',
    severity: 'warning',
    description: 'validate remediation queue wiring',
    actions: ['create', 'start', 'resolve']
  });
  assert.equal(created.status, 200);
  assert.equal(created.json?.ok, true);
  const remediationId = String(created.json?.item?.id || '');
  assert.ok(remediationId.length > 0);

  const started = await jpost('/api/autonomy/remediations/start', { id: remediationId });
  assert.equal(started.status, 200);
  assert.equal(started.json?.ok, true);
  assert.equal(started.json?.item?.status, 'running');

  const resolved = await jpost('/api/autonomy/remediations/resolve', {
    id: remediationId,
    resolution: 'phase52 resolved'
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.json?.ok, true);
  assert.equal(resolved.json?.item?.status, 'resolved');

  const fetched = await jget(`/api/autonomy/remediations/status?id=${encodeURIComponent(remediationId)}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json?.ok, true);
  assert.equal(fetched.json?.item?.id, remediationId);
  assert.equal(fetched.json?.item?.status, 'resolved');

  const sync = await jpost('/api/autonomy/remediations/sync-self-awareness', {});
  assert.equal(sync.status, 200);
  assert.equal(sync.json?.ok, true);

  console.log('phase52.autonomy-remediation-queue.e2e: ok');
} finally {
  await stopServer(proc);
}

