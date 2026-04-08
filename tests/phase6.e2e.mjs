import assert from 'node:assert/strict';
import { startServer, stopServer } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);

const p = await startServer();
try {
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.ok(html.includes('OpenUnum'));
  console.log('phase6 ok');
} finally {
  await stopServer(p);
}
