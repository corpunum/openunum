import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

let proc;
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || 18881);
const TEST_HOME = path.join(os.tmpdir(), `openunum-test-home-${TEST_PORT}`);

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

  const authCatalog = await jget('/api/auth/catalog');
  assert.equal(authCatalog.status, 200);
  assert.equal(authCatalog.json.contract_version, '2026-04-01.auth-catalog.v1');
  assert.deepEqual(authCatalog.json.provider_order, ['ollama', 'nvidia', 'openrouter', 'openai']);
  assert.equal(Array.isArray(authCatalog.json.providers), true);
  assert.equal(Array.isArray(authCatalog.json.auth_methods), true);
  assert.equal(Boolean(authCatalog.json.secret_store_path), true);
  assert.equal(authCatalog.json.providers.some((row) => row.provider === 'openai'), true);
  assert.equal(authCatalog.json.auth_methods.some((row) => row.id === 'github'), true);

  const savedAuth = await jpost('/api/auth/catalog', {
    providerBaseUrls: {
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      openrouterBaseUrl: 'https://openrouter.ai/api/v1',
      nvidiaBaseUrl: 'https://integrate.api.nvidia.com/v1',
      openaiBaseUrl: 'https://api.openai.com/v1'
    },
    secrets: {
      openrouterApiKey: 'sk-or-phase10-secret',
      nvidiaApiKey: 'nvapi-phase10-secret',
      openaiApiKey: 'sk-openai-phase10-secret',
      githubToken: 'ghp_phase10_secret',
      huggingfaceApiKey: 'hf_phase10_secret',
      elevenlabsApiKey: 'xi_phase10_secret',
      telegramBotToken: '123456:phase10-secret'
    }
  });
  assert.equal(savedAuth.status, 200);
  assert.equal(savedAuth.json.ok, true);
  assert.equal(savedAuth.json.catalog.providers.some((row) => row.provider === 'openrouter' && row.stored === true), true);

  const configFile = fs.readFileSync(path.join(TEST_HOME, 'openunum.json'), 'utf8');
  const secretFilePath = path.join(TEST_HOME, 'secrets.json');
  const secretFile = fs.readFileSync(secretFilePath, 'utf8');
  assert.equal(configFile.includes('sk-or-phase10-secret'), false);
  assert.equal(configFile.includes('nvapi-phase10-secret'), false);
  assert.equal(configFile.includes('ghp_phase10_secret'), false);
  assert.equal(secretFile.includes('sk-or-phase10-secret'), true);
  assert.equal(secretFile.includes('ghp_phase10_secret'), true);
  assert.equal((fs.statSync(secretFilePath).mode & 0o777), 0o600);

  const prefill = await jpost('/api/auth/prefill-local', { overwriteBaseUrls: false });
  assert.equal(prefill.status, 200);
  assert.equal(prefill.json.ok, true);
  assert.equal(Array.isArray(prefill.json.scannedFiles), true);

  const providerTest = await jpost('/api/provider/test', {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'invalid-openrouter-key'
  });
  assert.equal(providerTest.status, 200);
  assert.equal(typeof providerTest.json.ok, 'boolean');
  assert.equal(providerTest.json.provider, 'openrouter');

  const serviceTest = await jpost('/api/service/test', {
    service: 'github',
    secret: ''
  });
  assert.equal(serviceTest.status, 200);
  assert.equal(serviceTest.json.service, 'github');
  assert.equal(typeof serviceTest.json.ok, 'boolean');

  const oauthKickoff = await jpost('/api/service/connect', {
    service: 'github'
  });
  assert.equal(oauthKickoff.status, 200);
  assert.equal(typeof oauthKickoff.json.started, 'boolean');

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
