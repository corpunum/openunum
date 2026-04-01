import assert from 'node:assert/strict';
import { startServer, stopServer } from './_helpers.mjs';

const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || 18881);
let proc;

try {
  proc = await startServer();

  const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
  assert.equal(res.status, 200);
  const html = await res.text();

  const requiredMarkers = [
    'data-testid="status-bar"',
    'data-testid="session-search"',
    'data-testid="message-stream"',
    'data-testid="composer-input"',
    'data-testid="send-message"',
    'data-testid="provider-select"',
    'data-testid="model-select"',
    'data-testid="fallback-model-select"',
    'data-testid="autonomy-mode-select"',
    'data-testid="provider-health"',
    'data-testid="trace-panel"',
    'data-testid="provider-matrix"',
    'data-testid="auth-vault"'
  ];

  for (const marker of requiredMarkers) {
    assert.equal(html.includes(marker), true, `missing ${marker}`);
  }

  assert.equal(html.includes('<summary>Chat</summary>'), true);
  assert.equal(html.includes('<summary>Missions</summary>'), true);
  assert.equal(html.includes('<summary>Runtime</summary>'), true);
  assert.equal(html.includes('<summary>Settings</summary>'), true);
  assert.equal(html.includes('id="quickPrompts"'), true);
  assert.equal(html.includes('id="runtimeCards"'), true);
  assert.equal(html.includes('id="providerCards"'), true);
  assert.equal(html.includes('id="providerMatrixBody"'), true);
  assert.equal(html.includes('id="authMethodBody"'), true);
  assert.equal(html.includes('id="prefillLocalAuth"'), true);
  assert.equal(html.includes('id="refreshAuthCatalog"'), true);
  assert.equal(html.includes('id="providerAddSelect"'), true);
  assert.equal(html.includes('id="serviceAddSelect"'), true);
  assert.equal(html.includes('id="addProviderRow"'), true);
  assert.equal(html.includes('id="addServiceRow"'), true);
  assert.equal(html.includes('id="fallbackSequenceBody"'), true);
  assert.equal(html.includes('id="fallbackProviderPicker"'), true);
  assert.equal(html.includes('id="addFallbackRow"'), true);
  assert.equal(html.includes('id="autoFillFallbacks"'), true);
  assert.equal(html.includes('id="exportSessionBtn"'), true);
  assert.equal(html.includes('id="contextBudgetValue"'), true);
  assert.equal(html.includes('id="compactContextBtn"'), true);
  assert.equal(html.includes('id="refreshLedgerBtn"'), true);
  assert.equal(html.includes('id="tacticalLedger"'), true);
  assert.equal(html.includes('id="importSessionBtn"'), true);
  assert.equal(html.includes('id="importSessionFile"'), true);
  assert.equal(html.includes('id="missionTimeline"'), true);
  assert.equal(html.includes('id="missionTimelineFilter"'), true);
  assert.equal(html.includes('id="missionTimelineSearch"'), true);
  assert.equal(html.includes('id="missionTimelineArtifacts"'), true);
  assert.equal(html.includes('id="openMissionSessionBtn"'), true);
  assert.equal(html.includes('id="cloneMissionSessionBtn"'), true);

  console.log('phase11.e2e: ok');
} finally {
  await stopServer(proc);
}
