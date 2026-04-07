import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || 18881);
const TEST_HOME = path.join(os.tmpdir(), `openunum-test-home-${TEST_PORT}`);

function clearTestPort() {
  try {
    const out = execSync(`ss -ltnp 'sport = :${TEST_PORT}'`, { encoding: 'utf8' });
    const pids = [...out.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
    for (const pid of [...new Set(pids)]) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
  } catch {
    // port not in use
  }
}

export async function startServer() {
  clearTestPort();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
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
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (proc.exitCode == null) {
    proc.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
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
