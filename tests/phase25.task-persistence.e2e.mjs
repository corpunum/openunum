import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || await getFreePort());
const TEST_HOME = path.join(os.tmpdir(), `openunum-task-persistence-${TEST_PORT}`);

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('server start timeout');
}

function startServer() {
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
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function jget(pathname) {
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}${pathname}`);
  return { status: res.status, json: await res.json() };
}

async function jpost(pathname, body) {
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}${pathname}`, {
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
  await waitForHealth();

  const run = await jpost('/api/autonomy/tasks/run', {
    goal: 'verify persistence of a completed task run',
    sessionId: 'phase25-task',
    plan: ['check runtime health'],
    steps: [
      {
        kind: 'tool',
        label: 'check api health',
        tool: 'http_request',
        args: { method: 'GET', url: `http://127.0.0.1:${TEST_PORT}/api/health` }
      }
    ],
    verify: [{ kind: 'step_ok', stepIndex: 0 }]
  });
  assert.equal(run.status, 200);
  assert.equal(run.json.ok, true);
  const taskId = run.json.task.id;

  await stopServer(proc);
  proc = null;

  proc = startServer();
  await waitForHealth();

  const status = await jget(`/api/autonomy/tasks/status?id=${encodeURIComponent(taskId)}`);
  assert.equal(status.status, 200);
  assert.equal(status.json.ok, true);
  assert.equal(status.json.task.id, taskId);
  assert.equal(status.json.task.status, 'completed');
  assert.equal(status.json.task.stepResults.length, 1);

  const listed = await jget('/api/autonomy/tasks?limit=10');
  assert.equal(listed.status, 200);
  assert.equal(listed.json.ok, true);
  assert.equal(listed.json.tasks.some((task) => task.id === taskId), true);

  console.log('phase25.task-persistence.e2e: ok');
} finally {
  await stopServer(proc);
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
}
