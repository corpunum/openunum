import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();

  const caps = await jget('/api/capabilities');
  assert.equal(caps.status, 200);
  assert.deepEqual(caps.json.menu, ['chat', 'missions', 'trace', 'runtime', 'settings']);
  assert.deepEqual(caps.json.provider_order, ['ollama', 'nvidia', 'openrouter', 'openai']);

  const catalog = await jget('/api/model-catalog');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.json.contract_version, '2026-04-01.model-catalog.v1');
  assert.deepEqual(catalog.json.provider_order, ['ollama', 'nvidia', 'openrouter', 'openai']);
  assert.equal(Array.isArray(catalog.json.providers), true);
  assert.equal(catalog.json.providers.length, 4);
  assert.equal(Boolean(catalog.json.selected?.canonical_key), true);
  assert.equal(Boolean(catalog.json.fallback?.canonical_key), true);

  for (const provider of catalog.json.providers) {
    let previousScore = Number.POSITIVE_INFINITY;
    provider.models.forEach((model, index) => {
      assert.equal(model.rank, index + 1);
      assert.equal(typeof model.canonical_key, 'string');
      assert.equal(model.capability_score <= previousScore, true);
      previousScore = model.capability_score;
    });
  }

  const runtimeOverview = await jget('/api/runtime/overview');
  assert.equal(runtimeOverview.status, 200);
  assert.equal(typeof runtimeOverview.json.workspaceRoot, 'string');
  assert.equal(Array.isArray(runtimeOverview.json.providers), true);
  assert.equal(typeof runtimeOverview.json.git, 'object');
  assert.equal(typeof runtimeOverview.json.browser, 'object');

  const sessionId = `phase10-${Date.now()}`;
  const created = await jpost('/api/sessions', { sessionId });
  assert.equal(created.status, 200);

  const contextStatus = await jget(`/api/context/status?sessionId=${encodeURIComponent(sessionId)}`);
  assert.equal(contextStatus.status, 200);
  assert.equal(contextStatus.json.sessionId, sessionId);
  assert.equal(typeof contextStatus.json.estimatedTokens, 'number');
  assert.equal(typeof contextStatus.json.budget, 'object');

  const sessionExport = await jget(`/api/sessions/${encodeURIComponent(sessionId)}/export`);
  assert.equal(sessionExport.status, 200);
  assert.equal(sessionExport.json.sessionId, sessionId);
  assert.equal(Array.isArray(sessionExport.json.messages), true);
  assert.equal(typeof sessionExport.json.estimatedTokens, 'number');

  const autonomyInsights = await jget(`/api/autonomy/insights?sessionId=${encodeURIComponent(sessionId)}`);
  assert.equal(autonomyInsights.status, 200);
  assert.equal(autonomyInsights.json.sessionId, sessionId);
  assert.equal(Array.isArray(autonomyInsights.json.recentStrategies), true);
  assert.equal(Array.isArray(autonomyInsights.json.toolReliability), true);
  assert.equal(Array.isArray(autonomyInsights.json.recentToolRuns), true);

  const imported = await jpost('/api/sessions/import', {
    sessionId: `${sessionId}-imported`,
    messages: [
      { role: 'user', content: 'imported user message' },
      { role: 'assistant', content: 'imported assistant message' }
    ]
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.json.session.sessionId, `${sessionId}-imported`);

  const importedExport = await jget(`/api/sessions/${encodeURIComponent(`${sessionId}-imported`)}/export`);
  assert.equal(importedExport.status, 200);
  assert.equal(importedExport.json.messages.length >= 2, true);

  const cloned = await jpost('/api/sessions/clone', {
    sourceSessionId: `${sessionId}-imported`,
    targetSessionId: `${sessionId}-cloned`
  });
  assert.equal(cloned.status, 200);
  assert.equal(cloned.json.session.sessionId, `${sessionId}-cloned`);

  const missionStarted = await jpost('/api/missions/start', {
    goal: 'Check if /tmp directory exists',
    maxSteps: 1,
    intervalMs: 0
  });
  assert.equal(missionStarted.status, 200);
  const missionTimeline = await jget(`/api/missions/timeline?id=${encodeURIComponent(missionStarted.json.id)}`);
  assert.equal(missionTimeline.status, 200);
  assert.equal(missionTimeline.json.mission.id, missionStarted.json.id);
  assert.equal(Array.isArray(missionTimeline.json.log), true);
  assert.equal(Array.isArray(missionTimeline.json.toolRuns), true);

  console.log('phase10.e2e: ok');
} finally {
  await stopServer(proc);
}
