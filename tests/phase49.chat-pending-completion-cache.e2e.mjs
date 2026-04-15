import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

let proc;
let hangingServer;

try {
  hangingServer = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.on('close', () => {
        try { res.end(); } catch {}
      });
      // Intentionally keep the response open. Chat runtime should hit its own hard timeout.
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const hangingPort = hangingServer.address().port;
  proc = await startServer();

  const cfg = await jpost('/api/config', {
    runtime: {
      providerRequestTimeoutMs: 60000,
      chatHardTimeoutMs: 22000,
      chatCompletionCacheTtlMs: 180000
    },
    model: {
      provider: 'openai',
      model: 'openai/gpt-4o-mini',
      openaiBaseUrl: `http://127.0.0.1:${hangingPort}/v1`
    }
  });
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.ok, true);

  const sessionId = `phase49-${Date.now()}`;
  const started = await jpost('/api/chat', {
    sessionId,
    message: 'say hello'
  });
  assert.equal(started.status === 200 || started.status === 202, true);

  let sawPending = Boolean(started.json?.pending);
  let sawCompletedPayload = false;
  let completedReply = '';

  const deadline = Date.now() + 40000;
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
  await new Promise((resolve) => {
    if (!hangingServer) return resolve();
    hangingServer.close(() => resolve());
  });
}
