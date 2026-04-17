import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const EXTERNAL_BASE_URL = process.env.OPENUNUM_BASE_URL || process.env.OPENUNUM_API_URL || '';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForReady(baseUrl, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function request(method, path, body = undefined) {
  const baseUrl = process.env.OPENUNUM_BASE_URL || process.env.OPENUNUM_API_URL;
  const url = `${baseUrl}${path}`;
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
  let server = null;
  let tempHome = null;
  let activeBaseUrl = EXTERNAL_BASE_URL;

  if (activeBaseUrl) {
    const ready = await waitForReady(activeBaseUrl, 2500);
    assert.equal(ready, true, `failed to reach configured UI smoke base URL: ${activeBaseUrl}`);
    process.env.OPENUNUM_BASE_URL = activeBaseUrl;
    process.env.OPENUNUM_API_URL = activeBaseUrl;
  } else {
    const port = await getFreePort();
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-ui-smoke-'));
    activeBaseUrl = `http://127.0.0.1:${port}`;
    process.env.OPENUNUM_BASE_URL = activeBaseUrl;
    process.env.OPENUNUM_API_URL = activeBaseUrl;

    server = spawn('node', [path.join(ROOT, 'src', 'server.mjs')], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        OPENUNUM_HOME: tempHome,
        OPENUNUM_PORT: String(port)
      }
    });
    const started = await waitForReady(activeBaseUrl, 20000);
    assert.equal(started, true, 'failed to start temporary server for UI smoke');
  }

  console.log(`UI smoke (no oauth connect) against ${activeBaseUrl}`);

  try {
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
    '/api/runtime/inventory',
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
      intervalMs: 10
    });
    ensureHttpOk('POST /api/missions/start', missionStart);
    const missionId = missionStart.json?.id;
    assert.equal(typeof missionId, 'string', 'mission id missing');
    ensureHttpOk('GET /api/missions/status', await request('GET', `/api/missions/status?id=${encodeURIComponent(missionId)}`));
    ensureHttpOk('POST /api/missions/stop', await request('POST', '/api/missions/stop', { id: missionId }));

    console.log('PASS: UI/API smoke checks completed (no oauth connect endpoints invoked)');
  } finally {
    if (server) {
      server.kill('SIGTERM');
      try { await once(server, 'exit'); } catch {}
    }
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error('FAIL:', error?.message || error);
  process.exit(1);
});
