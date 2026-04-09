import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();

  const cfg = await jpost('/api/config', {
    runtime: {
      providerRequestTimeoutMs: 120000,
      chatHardTimeoutMs: 90000,
      chatCompletionCacheTtlMs: 180000
    }
  });
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.ok, true);

  const sessionId = `phase49-${Date.now()}`;
  const started = await jpost('/api/chat', {
    sessionId,
    message: 'can you search the best github open source project of month march and april 2026 and give me a table without links'
  });
  assert.equal(started.status === 200 || started.status === 202, true);

  let sawPending = Boolean(started.json?.pending);
  let sawCompletedPayload = false;
  let completedReply = '';

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const pending = await jget(`/api/chat/pending?sessionId=${encodeURIComponent(sessionId)}`);
    assert.equal(pending.status, 200);
    if (pending.json?.pending) {
      sawPending = true;
      await new Promise((resolve) => setTimeout(resolve, 800));
      continue;
    }
    if (pending.json?.completed === true && typeof pending.json?.reply === 'string') {
      sawCompletedPayload = true;
      completedReply = pending.json.reply;
    }
    break;
  }

  const session = await jget(`/api/sessions/${encodeURIComponent(sessionId)}`);
  assert.equal(session.status, 200);
  const messages = session.json?.messages || [];
  const assistant = messages.filter((m) => m.role === 'assistant').at(-1);
  assert.equal(typeof assistant?.content, 'string');
  assert.equal(assistant.content.length > 0, true);

  if (sawPending) {
    assert.equal(sawCompletedPayload, true);
    assert.equal(completedReply.length > 0, true);
  }

  console.log('phase49.chat-pending-completion-cache.e2e: ok');
} finally {
  await stopServer(proc);
}

