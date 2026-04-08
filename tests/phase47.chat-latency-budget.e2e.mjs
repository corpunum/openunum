import assert from 'node:assert/strict';
import { startServer, stopServer, jpost } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();
  const sid = `phase47-${Date.now()}`;
  const out = await jpost('/api/chat', { sessionId: sid, message: 'hello' });
  assert.equal(out.status, 200);
  assert.equal(typeof out.json.reply, 'string');
  assert.equal(typeof out.json.trace, 'object');
  assert.equal(typeof out.json.trace.latency, 'object');
  assert.equal(typeof out.json.trace.latencyBudget, 'object');
  assert.equal(typeof out.json.trace.latencyBudget.withinBudget, 'boolean');
  assert.equal(typeof out.json.trace.latencyBudget.thresholdsMs, 'object');
  assert.equal(typeof out.json.trace.latencyBudget.thresholdsMs.total, 'number');
  console.log('phase47.chat-latency-budget.e2e: ok');
} finally {
  await stopServer(proc);
}
