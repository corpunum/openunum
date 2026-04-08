import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);
let proc;

async function del(path) {
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}${path}`, { method: 'DELETE' });
  return { status: res.status, json: await res.json() };
}

try {
  proc = await startServer();

  const keepSessionId = 'phase15-keep';
  const dropA = 'phase15-drop-a';
  const dropB = 'phase15-drop-b';

  await jpost('/api/sessions', { sessionId: keepSessionId });
  await jpost('/api/sessions', { sessionId: dropA });
  await jpost('/api/sessions', { sessionId: dropB });

  const before = await jget('/api/sessions?limit=20');
  assert.equal(before.status, 200);
  assert.equal(before.json.sessions.some((s) => s.sessionId === keepSessionId), true);
  assert.equal(before.json.sessions.some((s) => s.sessionId === dropA), true);
  assert.equal(before.json.sessions.some((s) => s.sessionId === dropB), true);

  const guard = await jpost('/api/sessions/clear', {});
  assert.equal(guard.status, 400);

  const opClearId = 'phase15-op-clear-1';
  const cleared = await jpost('/api/sessions/clear', { keepSessionId, operationId: opClearId });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.keepSessionId, keepSessionId);
  assert.equal(cleared.json.operationId, opClearId);
  assert.equal(Boolean(cleared.json.replayed), false);

  const clearedReplay = await jpost('/api/sessions/clear', { keepSessionId, operationId: opClearId });
  assert.equal(clearedReplay.status, 200);
  assert.equal(Boolean(clearedReplay.json.replayed), true);

  const afterClear = await jget('/api/sessions?limit=20');
  assert.equal(afterClear.status, 200);
  const idsAfterClear = new Set(afterClear.json.sessions.map((s) => s.sessionId));
  assert.equal(idsAfterClear.has(keepSessionId), true);
  assert.equal(idsAfterClear.has(dropA), false);
  assert.equal(idsAfterClear.has(dropB), false);

  await jpost('/api/sessions', { sessionId: 'phase15-delete-one' });
  const opDeleteId = 'phase15-op-delete-1';
  const deleted = await del(`/api/sessions/phase15-delete-one?operationId=${encodeURIComponent(opDeleteId)}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.json.deleted, true);
  assert.equal(deleted.json.operationId, opDeleteId);
  assert.equal(Boolean(deleted.json.replayed), false);

  const deletedReplay = await del(`/api/sessions/phase15-delete-one?operationId=${encodeURIComponent(opDeleteId)}`);
  assert.equal(deletedReplay.status, 200);
  assert.equal(Boolean(deletedReplay.json.replayed), true);

  const afterDelete = await jget('/api/sessions?limit=20');
  assert.equal(afterDelete.status, 200);
  assert.equal(afterDelete.json.sessions.some((s) => s.sessionId === 'phase15-delete-one'), false);

  const receipts = await jget('/api/operations/recent?limit=20');
  assert.equal(receipts.status, 200);
  const opIds = new Set((receipts.json.receipts || []).map((r) => r.operationId));
  assert.equal(opIds.has(opClearId), true);
  assert.equal(opIds.has(opDeleteId), true);

  const toolCatalog = await jget('/api/tools/catalog');
  assert.equal(toolCatalog.status, 200);
  const toolNames = new Set((toolCatalog.json.tools || []).map((t) => t.name));
  assert.equal(toolNames.has('session_clear'), true);
  assert.equal(toolNames.has('session_delete'), true);

  console.log('phase15.session-delete.e2e: ok');
} finally {
  await stopServer(proc);
}
