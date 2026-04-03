import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE_URL = process.env.OPENUNUM_BASE_URL || 'http://127.0.0.1:18880';

async function request(method, path, body = undefined) {
  const url = `${BASE_URL}${path}`;
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = null;
  }
  return { status: res.status, raw, json };
}

function ensureHttpOk(name, out) {
  assert.equal(out.status >= 200 && out.status < 300, true, `${name} failed: status=${out.status}`);
}

function ensureEndpointExists(name, out) {
  assert.equal(out.status !== 404, true, `${name} missing (404)`);
}

async function main() {
  console.log(`UI smoke (no oauth connect) against ${BASE_URL}`);

  const root = await request('GET', '/');
  ensureHttpOk('GET /', root);
  assert.equal(root.raw.includes('data-testid="status-bar"'), true, 'ui marker missing: status-bar');
  assert.equal(root.raw.includes('data-testid="session-search"'), true, 'ui marker missing: session-search');
  assert.equal(root.raw.includes('data-testid="message-stream"'), true, 'ui marker missing: message-stream');
  assert.equal(root.raw.includes('data-testid="provider-matrix"'), true, 'ui marker missing: provider-matrix');
  assert.equal(root.raw.includes('data-testid="auth-vault"'), true, 'ui marker missing: auth-vault');

  const health = await request('GET', '/api/health');
  ensureHttpOk('GET /api/health', health);

  const sessionA = crypto.randomUUID();
  const sessionB = crypto.randomUUID();

  const safeGets = [
    '/api/capabilities',
    '/api/model/current',
    '/api/model-catalog',
    '/api/runtime/overview',
    '/api/auth/catalog',
    '/api/config',
    '/api/providers/config',
    '/api/browser/config',
    '/api/browser/status',
    '/api/telegram/config',
    '/api/telegram/status',
    '/api/missions',
    '/api/sessions',
    `/api/context/status?sessionId=${encodeURIComponent(sessionA)}`,
    `/api/autonomy/insights?sessionId=${encodeURIComponent(sessionA)}`
  ];
  for (const path of safeGets) {
    const out = await request('GET', path);
    ensureEndpointExists(`GET ${path}`, out);
  }

  ensureHttpOk('POST /api/sessions (A)', await request('POST', '/api/sessions', { sessionId: sessionA }));
  ensureHttpOk('POST /api/sessions (B)', await request('POST', '/api/sessions', { sessionId: sessionB }));

  const msgA = [{ role: 'user', content: 'session-a' }, { role: 'assistant', content: 'ack-a' }];
  const msgB = [{ role: 'user', content: 'session-b' }, { role: 'assistant', content: 'ack-b' }];
  ensureHttpOk('POST /api/sessions/import (A)', await request('POST', '/api/sessions/import', { sessionId: sessionA, messages: msgA }));
  ensureHttpOk('POST /api/sessions/import (B)', await request('POST', '/api/sessions/import', { sessionId: sessionB, messages: msgB }));

  const outA = await request('GET', `/api/sessions/${encodeURIComponent(sessionA)}?html=false`);
  const outB = await request('GET', `/api/sessions/${encodeURIComponent(sessionB)}?html=false`);
  ensureHttpOk('GET /api/sessions/:id (A)', outA);
  ensureHttpOk('GET /api/sessions/:id (B)', outB);
  assert.equal(Array.isArray(outA.json?.messages), true, 'session A messages missing');
  assert.equal(Array.isArray(outB.json?.messages), true, 'session B messages missing');
  assert.equal(outA.json.messages.some((m) => String(m.content || '').includes('ack-a')), true, 'session A content mismatch');
  assert.equal(outB.json.messages.some((m) => String(m.content || '').includes('ack-b')), true, 'session B content mismatch');

  const activityA = await request('GET', `/api/sessions/${encodeURIComponent(sessionA)}/activity?since=${encodeURIComponent(new Date(0).toISOString())}`);
  const activityB = await request('GET', `/api/sessions/${encodeURIComponent(sessionB)}/activity?since=${encodeURIComponent(new Date(0).toISOString())}`);
  ensureEndpointExists('GET /api/sessions/:id/activity (A)', activityA);
  ensureEndpointExists('GET /api/sessions/:id/activity (B)', activityB);

  const missionStart = await request('POST', '/api/missions/start', {
    goal: 'Smoke mission no-oauth',
    maxSteps: 1,
    intervalMs: 0
  });
  ensureHttpOk('POST /api/missions/start', missionStart);
  const missionId = missionStart.json?.id;
  assert.equal(typeof missionId, 'string', 'mission id missing');
  ensureHttpOk('GET /api/missions/status', await request('GET', `/api/missions/status?id=${encodeURIComponent(missionId)}`));
  ensureHttpOk('POST /api/missions/stop', await request('POST', '/api/missions/stop', { id: missionId }));

  console.log('PASS: UI/API smoke checks completed (no oauth connect endpoints invoked)');
}

main().catch((error) => {
  console.error('FAIL:', error?.message || error);
  process.exit(1);
});

