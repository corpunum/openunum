import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from '../_helpers.mjs';

describe('Verifier System', () => {
  let proc;

  before(async () => {
    proc = await startServer();
  });

  after(async () => {
    await stopServer(proc);
  });

  it('returns verifier stats contract', async () => {
    const res = await jget('/api/verifier/stats');
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.total, 'number');
    assert.equal(typeof res.json.passed, 'number');
    assert.equal(typeof res.json.failed, 'number');
  });

  it('verifies state transitions with required fields', async () => {
    const res = await jpost('/api/verifier/check', {
      type: 'state',
      before: { id: 'm1', status: 'pending', updatedAt: '2026-04-08T00:00:00.000Z' },
      after: { id: 'm1', status: 'completed', updatedAt: '2026-04-08T00:00:01.000Z' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.verified, true);
    assert.equal(Array.isArray(res.json.checks), true);
    assert.equal(typeof res.json.confidence, 'number');
  });

  it('rejects invalid state status transitions', async () => {
    const res = await jpost('/api/verifier/check', {
      type: 'state',
      before: { id: 'm1', status: 'pending' },
      after: { id: 'm1', status: 'not_a_real_status' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.verified, false);
    const failedChecks = (res.json.checks || []).filter((c) => c?.passed === false);
    assert.equal(failedChecks.length > 0, true);
  });

  it('verifies tool results and flags tool errors', async () => {
    const okRes = await jpost('/api/verifier/check', {
      type: 'tool',
      toolName: 'file_read',
      args: { path: '/tmp/a.txt' },
      after: { ok: true, content: 'abc' }
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.json.verified, true);

    const badRes = await jpost('/api/verifier/check', {
      type: 'tool',
      toolName: 'file_read',
      args: { path: '/tmp/missing.txt' },
      after: { ok: false, error: 'ENOENT' }
    });
    assert.equal(badRes.status, 200);
    assert.equal(badRes.json.verified, false);
  });
});
