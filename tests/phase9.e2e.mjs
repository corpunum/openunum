import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

const p = await startServer();
try {
  const sessionId = `phase9-${Date.now()}`;

  const cfg = await jpost('/api/config', {
    runtime: {
      contextCompactionEnabled: true,
      contextCompactTriggerPct: 0.25,
      contextCompactTargetPct: 0.2,
      contextProtectRecentTurns: 2,
      contextFallbackTokens: 500
    }
  });
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.ok, true);

  const longText = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda '.repeat(20);
  for (let i = 0; i < 6; i += 1) {
    const chat = await jpost('/api/chat', {
      sessionId,
      message: `phase9 message ${i} ${longText}`
    });
    assert.ok(chat.status === 200 || chat.status === 202);
  }

  const status = await jget(`/api/context/status?sessionId=${encodeURIComponent(sessionId)}`);
  assert.equal(status.status, 200);
  assert.equal(status.json.ok, true);

  const dryRun = await jpost('/api/context/compact', { sessionId, dryRun: true });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.json.ok, true);

  const apply = await jpost('/api/context/compact', { sessionId, dryRun: false });
  assert.equal(apply.status, 200);
  assert.equal(apply.json.ok, true);

  const compactions = await jget(`/api/context/compactions?sessionId=${encodeURIComponent(sessionId)}&limit=5`);
  assert.equal(compactions.status, 200);
  assert.equal(compactions.json.ok, true);
  assert.ok(Array.isArray(compactions.json.compactions));
  assert.ok(compactions.json.compactions.length >= 1);

  const artifacts = await jget(`/api/context/artifacts?sessionId=${encodeURIComponent(sessionId)}&limit=10`);
  assert.equal(artifacts.status, 200);
  assert.equal(artifacts.json.ok, true);
  assert.ok(Array.isArray(artifacts.json.artifacts));

  console.log('phase9 ok');
} finally {
  await stopServer(p);
}

