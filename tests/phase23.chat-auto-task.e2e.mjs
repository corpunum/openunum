import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();

  const cfg = await jpost('/api/config', {
    runtime: {
      agentTurnTimeoutMs: 2000,
      providerRequestTimeoutMs: 2000,
      missionDefaultHardStepCap: 4,
      missionDefaultMaxRetries: 1,
      missionDefaultIntervalMs: 100
    }
  });
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.ok, true);

  const sessionId = `phase23-${Date.now()}`;
  const started = await jpost('/api/chat', {
    sessionId,
    message: '/auto inspect the runtime, act autonomously, and report proof'
  });
  assert.equal(started.status === 200 || started.status === 202, true);

  const deadline = Date.now() + 30000;
  let latestSession = null;
  while (Date.now() < deadline) {
    const pending = await jget(`/api/chat/pending?sessionId=${encodeURIComponent(sessionId)}`);
    const session = await jget(`/api/sessions/${encodeURIComponent(sessionId)}`);
    latestSession = session;
    const assistant = (session.json?.messages || []).filter((m) => m.role === 'assistant').at(-1);
    if (!pending.json?.pending && assistant?.content?.includes('Autonomous task')) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  assert.equal(Boolean(latestSession), true);
  const messages = latestSession.json?.messages || [];
  const assistant = messages.filter((m) => m.role === 'assistant').at(-1);
  assert.equal(Boolean(assistant?.content?.includes('Autonomous task')), true);

  const tasks = await jget('/api/autonomy/tasks?limit=10');
  assert.equal(tasks.status, 200);
  assert.equal(tasks.json.ok, true);
  assert.equal(Array.isArray(tasks.json.tasks), true);
  assert.equal(tasks.json.tasks.length >= 1, true);

  console.log('phase23.chat-auto-task.e2e: ok');
} finally {
  await stopServer(proc);
}
