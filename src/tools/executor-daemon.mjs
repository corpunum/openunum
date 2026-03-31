import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLogPath() {
  return path.join(process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum'), 'logs', 'executor.jsonl');
}

export class ExecutorDaemon {
  constructor({ retryAttempts = 3, retryBackoffMs = 700 } = {}) {
    this.retryAttempts = Math.max(1, Number(retryAttempts || 3));
    this.retryBackoffMs = Math.max(0, Number(retryBackoffMs || 700));
    this.jobSeq = 0;
    const logPath = getLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    this.logPath = logPath;
  }

  appendLog(entry) {
    fs.appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`);
  }

  async runWithRetry(kind, payload, fn) {
    const jobId = `exec-${Date.now()}-${++this.jobSeq}`;
    let attempt = 0;
    let lastResult = null;

    while (attempt < this.retryAttempts) {
      attempt += 1;
      const startedAt = new Date().toISOString();
      try {
        const result = await fn();
        lastResult = result;
        this.appendLog({
          jobId,
          kind,
          payload,
          attempt,
          startedAt,
          finishedAt: new Date().toISOString(),
          ok: Boolean(result?.ok),
          result
        });
        if (result?.ok) {
          return { ...result, jobId, attempts: attempt };
        }
      } catch (error) {
        lastResult = { ok: false, error: String(error.message || error) };
        this.appendLog({
          jobId,
          kind,
          payload,
          attempt,
          startedAt,
          finishedAt: new Date().toISOString(),
          ok: false,
          result: lastResult
        });
      }

      if (attempt < this.retryAttempts && this.retryBackoffMs > 0) {
        await sleep(this.retryBackoffMs * attempt);
      }
    }

    return {
      ...(lastResult || { ok: false, error: 'executor_failed' }),
      jobId,
      attempts: attempt
    };
  }

  runShell(cmd, timeoutMs = 120000, options = {}) {
    const cwd = options?.cwd || process.cwd();
    return this.runWithRetry('shell', { cmd, timeoutMs, cwd }, async () => new Promise((resolve) => {
      exec(cmd, { timeout: timeoutMs, cwd }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code ?? 0,
          stdout,
          stderr,
          error: error?.message || null
        });
      });
    }));
  }
}
