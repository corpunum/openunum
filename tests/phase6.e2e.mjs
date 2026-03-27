import assert from 'node:assert/strict';
import { startServer, stopServer } from './_helpers.mjs';

const p = await startServer();
try {
  const res = await fetch('http://127.0.0.1:18881/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.ok(html.includes('OpenUnum'));
  console.log('phase6 ok');
} finally {
  await stopServer(p);
}
