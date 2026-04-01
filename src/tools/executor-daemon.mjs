import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingMs(deadlineAt) {
  if (!Number.isFinite(deadlineAt)) return Number.POSITIVE_INFINITY;
  return Number(deadlineAt) - Date.now();
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function extractOllamaReply(stdout) {
  const cleaned = stripAnsi(stdout)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[⠁-⣿]/g, '').trim())
    .filter(Boolean)
    .filter((line) => !/^User:?$/i.test(line))
    .filter((line) => !/^Assistant:?$/i.test(line))
    .filter((line) => !/^Respond to this with/i.test(line));
  if (!cleaned.length) return '';
  const assistantLine = cleaned.findLast((line) => /^Assistant:/i.test(line));
  if (assistantLine) return assistantLine.replace(/^Assistant:\s*/i, '').trim();
  return cleaned[cleaned.length - 1];
}

function normalizeShellResult(cmd, result) {
  const normalized = { ...result };
  if (/ollama run\b/i.test(String(cmd || ''))) {
    const reply = extractOllamaReply(result?.stdout || '');
    if (!normalized.ok && reply) {
      normalized.ok = true;
      normalized.code = 0;
      normalized.error = null;
      normalized.text = reply;
      normalized.stdout = stripAnsi(String(result?.stdout || ''));
    } else if (reply) {
      normalized.text = reply;
      normalized.stdout = stripAnsi(String(result?.stdout || ''));
    }
  }
  return normalized;
}

function isNonRetryableShellFailure(result) {
  const stderr = stripAnsi(String(result?.stderr || ''));
  const error = stripAnsi(String(result?.error || ''));
  const combined = `${stderr}\n${error}`.toLowerCase();
  return [
    'unknown flag:',
    'unknown command',
    'invalid option',
    'unrecognized option',
    'usage:',
    'command not found',
    'no such file or directory',
    'is not in the sudoers file'
  ].some((marker) => combined.includes(marker));
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

  async runWithRetry(kind, payload, fn, options = {}) {
    const jobId = `exec-${Date.now()}-${++this.jobSeq}`;
    let attempt = 0;
    let lastResult = null;
    const deadlineAt = Number.isFinite(options?.deadlineAt) ? Number(options.deadlineAt) : null;

    while (attempt < this.retryAttempts) {
      if (deadlineAt != null && remainingMs(deadlineAt) <= 0) {
        return {
          ...(lastResult || { ok: false, error: 'turn_deadline_exceeded' }),
          ok: false,
          error: 'turn_deadline_exceeded',
          jobId,
          attempts: attempt
        };
      }
      attempt += 1;
      const startedAt = new Date().toISOString();
      try {
        const result = await fn({ attempt, deadlineAt });
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
        if (kind === 'shell' && isNonRetryableShellFailure(result)) {
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
        const backoffMs = this.retryBackoffMs * attempt;
        if (deadlineAt != null) {
          const msLeft = remainingMs(deadlineAt);
          if (msLeft <= 0) break;
          await sleep(Math.min(backoffMs, msLeft));
        } else {
          await sleep(backoffMs);
        }
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
    const deadlineAt = Number.isFinite(options?.deadlineAt) ? Number(options.deadlineAt) : null;
    return this.runWithRetry('shell', { cmd, timeoutMs, cwd }, async ({ deadlineAt: attemptDeadlineAt } = {}) => new Promise((resolve) => {
      const msLeft = Number.isFinite(attemptDeadlineAt) ? remainingMs(attemptDeadlineAt) : Number.POSITIVE_INFINITY;
      const effectiveTimeout = Math.max(1000, Math.min(timeoutMs, Number.isFinite(msLeft) ? msLeft : timeoutMs));
      exec(cmd, { timeout: effectiveTimeout, cwd }, (error, stdout, stderr) => {
        resolve(normalizeShellResult(cmd, {
          ok: !error,
          code: error?.code ?? 0,
          stdout,
          stderr,
          error: error?.message || null
        }));
      });
    }), { deadlineAt });
  }
}
