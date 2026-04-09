import assert from 'node:assert/strict';
import { startServer, stopServer, jpost } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();
  const sid = `phase48-${Date.now()}`;

  const out = await jpost('/api/chat', { sessionId: sid, message: 'hello' });
  assert.equal(out.status, 200);
  assert.equal(typeof out.json.reply, 'string');
  assert.ok(out.json.reply.length > 0);
  assert.equal(typeof out.json.trace, 'object');
  assert.equal(out.json.trace.fastPathUsed, true);
  assert.equal(out.json.trace.fastPathDeterministic, true);
  assert.equal(out.json.trace.fastPathCategory, 'greeting');
  assert.equal(Array.isArray(out.json.trace.iterations), true);
  assert.equal(out.json.trace.iterations.length, 0);

  console.log('phase48.short-turn-deterministic-fastpath.e2e: ok');
} finally {
  await stopServer(proc);
}
