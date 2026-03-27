import assert from 'node:assert/strict';
import { startServer, stopServer, jget } from './_helpers.mjs';

const p = await startServer();
try {
  const h = await jget('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.json.ok, true);
  console.log('phase0 ok');
} finally {
  await stopServer(p);
}
