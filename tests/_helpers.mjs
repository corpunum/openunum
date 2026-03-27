import { spawn } from 'node:child_process';

export async function startServer() {
  const proc = spawn('node', ['src/server.mjs'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server start timeout')), 15000);
    const onData = (buf) => {
      const s = String(buf);
      if (s.includes('openunum_server_started')) {
        clearTimeout(t);
        proc.stdout.off('data', onData);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => {
      const s = String(d);
      if (s.toLowerCase().includes('error')) {
        // keep running; error may be noisy dependency logs
      }
    });
  });

  return proc;
}

export async function stopServer(proc) {
  if (!proc) return;
  proc.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

export async function jget(path) {
  const res = await fetch(`http://127.0.0.1:18880${path}`);
  return { status: res.status, json: await res.json() };
}

export async function jpost(path, body) {
  const res = await fetch(`http://127.0.0.1:18880${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}
