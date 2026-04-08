import assert from 'node:assert/strict';
import { startServer, stopServer } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);

async function postSessions({ origin = '', marker = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (marker) headers['X-OpenUnum-Request'] = marker;
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId: `origin-guard-${Date.now()}` })
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, headers: res.headers };
}

let proc;
try {
  proc = await startServer();

  {
    const badPreflight = await fetch(`http://127.0.0.1:${TEST_PORT}/api/sessions`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:3000',
        'Access-Control-Request-Method': 'POST'
      }
    });
    const payload = await badPreflight.json();
    assert.equal(badPreflight.status, 403, 'non-localcontrol preflight should be blocked');
    assert.equal(payload.error, 'origin_not_allowed');
  }

  {
    const goodPreflight = await fetch(`http://127.0.0.1:${TEST_PORT}/api/sessions`, {
      method: 'OPTIONS',
      headers: {
        Origin: `http://127.0.0.1:${TEST_PORT}`,
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.equal(goodPreflight.status, 204, 'same-origin preflight should pass');
    assert.equal(goodPreflight.headers.get('access-control-allow-origin'), `http://127.0.0.1:${TEST_PORT}`);
  }

  {
    const out = await postSessions({ origin: 'http://127.0.0.1:3000' });
    assert.equal(out.status, 403, 'cross-localhost mutating request should be blocked');
    assert.equal(out.json.error, 'origin_not_allowed');
  }

  {
    const out = await postSessions({ origin: `http://127.0.0.1:${TEST_PORT}` });
    assert.equal(out.status, 403, 'same-origin browser mutation without marker should be blocked');
    assert.equal(out.json.error, 'request_marker_required');
  }

  {
    const out = await postSessions({ origin: `http://127.0.0.1:${TEST_PORT}`, marker: 'webui' });
    assert.equal(out.status, 200, 'same-origin browser mutation with marker should succeed');
    assert.equal(out.json.ok, true);
  }

  {
    const out = await postSessions();
    assert.equal(out.status, 200, 'non-browser mutation (no origin) should remain allowed for CLI/tests');
    assert.equal(out.json.ok, true);
  }

  console.log('phase40.origin-guard.e2e: ok');
} finally {
  await stopServer(proc);
}

