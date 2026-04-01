import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || 18881);
const TEST_HOME = path.join(os.tmpdir(), `openunum-test-home-${TEST_PORT}`);

export async function startServer() {
  const proc = spawn('node', ['src/server.mjs'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENUNUM_PORT: String(TEST_PORT),
      OPENUNUM_HOME: TEST_HOME
    }
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (proc.exitCode != null) {
      throw new Error(`server exited early: ${proc.exitCode}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      if (res.ok) return proc;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server start timeout');

  return proc;
}

export async function stopServer(proc) {
  if (!proc) return;
  proc.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

export async function jget(path) {
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}${path}`);
  return { status: res.status, json: await res.json() };
}

export async function jpost(path, body) {
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}
