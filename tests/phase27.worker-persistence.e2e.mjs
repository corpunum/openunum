import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || 18884);
const TEST_HOME = path.join(os.tmpdir(), `openunum-test-home-${TEST_PORT}-persist`);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function clearTestPort() {
  try {
    const out = execSync(`ss -ltnp 'sport = :${TEST_PORT}'`, { encoding: 'utf8' });
    const pids = [...out.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
    for (const pid of [...new Set(pids)]) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
  } catch {}
}

async function waitForServer(proc) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (proc.exitCode != null) throw new Error(`server exited early: ${proc.exitCode}`);
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server start timeout');
}

function startServer() {
  clearTestPort();
  const proc = spawn('node', ['src/server.mjs'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENUNUM_PORT: String(TEST_PORT),
      OPENUNUM_HOME: TEST_HOME
    }
  });
  return proc;
}

async function stopServer(proc) {
  if (!proc) return;
  proc.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function jget(route) {
  const res = await fetch(`${BASE_URL}${route}`);
  return { status: res.status, json: await res.json() };
}

async function jpost(route, body) {
  const res = await fetch(`${BASE_URL}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}

let proc;

try {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  proc = startServer();
  await waitForServer(proc);

  const started = await jpost('/api/autonomy/workers/start', {
    name: 'phase27-persisted-worker',
    goal: 'verify worker survives restart',
    allowedTools: ['shell_run'],
    steps: [{ tool: 'shell_run', args: { cmd: 'printf persisted-worker' } }],
    delayMs: 60000,
    intervalMs: 60000,
    maxRuns: 3
  });
  assert.equal(started.status, 200);
  const workerId = started.json.worker.id;
  assert.equal(started.json.worker.status, 'scheduled');

  await stopServer(proc);
  proc = startServer();
  await waitForServer(proc);

  const status = await jget(`/api/autonomy/workers/status?id=${encodeURIComponent(workerId)}`);
  assert.equal(status.status, 200);
  assert.equal(status.json.ok, true);
  assert.equal(status.json.worker.id, workerId);
  assert.equal(status.json.worker.status, 'scheduled');

  const ticked = await jpost('/api/autonomy/workers/tick', { id: workerId });
  assert.equal(ticked.status, 200);
  assert.equal(ticked.json.ok, true);
  assert.equal(Boolean(ticked.json.execution?.ok), true);

  console.log('phase27.worker-persistence.e2e: ok');
} finally {
  await stopServer(proc);
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
}
