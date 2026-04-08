#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TEMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-smoke-'));

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

async function waitForReady({ baseUrl, server, timeoutMs = 20000 }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.exitCode !== null) {
      throw new Error(`server_exited_early_with_${server.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server_not_ready_within_${timeoutMs}ms`);
}

async function runNodeScript(scriptName, env) {
  const proc = spawn('node', [path.join(ROOT, 'scripts', scriptName)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
  const [code] = await once(proc, 'exit');
  if (code !== 0) {
    throw new Error(`${scriptName}_failed_with_${code}`);
  }
}

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    OPENUNUM_HOME: TEMP_HOME,
    OPENUNUM_PORT: String(port),
    OPENUNUM_API_URL: baseUrl,
    OPENUNUM_EXPECTED_PORT: String(port)
  };

  const server = spawn('node', [path.join(ROOT, 'src', 'server.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });

  try {
    await waitForReady({ baseUrl, server });
    await runNodeScript('smoke-check.mjs', env);
    await runNodeScript('smoke-audit.mjs', env);
    await runNodeScript('smoke-verifier.mjs', env);
    await runNodeScript('smoke-memory.mjs', env);
    await runNodeScript('smoke-chat-stream.mjs', env);
    await runNodeScript('smoke-roles-approvals.mjs', env);
    console.log(`✅ Isolated smoke suite passed on ${baseUrl}`);
  } finally {
    server.kill('SIGTERM');
    try {
      await once(server, 'exit');
    } catch {}
    fs.rmSync(TEMP_HOME, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ isolated smoke failed:', err.message);
  process.exit(1);
});
