import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return crypto.randomUUID();
}

const VALID_TYPES = ['file_watcher', 'process', 'http_monitor'];
const VALID_STATES = ['stopped', 'starting', 'running', 'failed', 'stale'];

function normalizeType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (t === 'file' || t === 'file_watcher') return 'file_watcher';
  if (t === 'process' || t === 'proc' || t === 'service') return 'process';
  if (t === 'http' || t === 'http_monitor' || t === 'monitor' || t === 'health') return 'http_monitor';
  return null;
}

function normalizeState(state) {
  const s = String(state || '').trim().toLowerCase();
  if (VALID_STATES.includes(s)) return s;
  return 'stopped';
}

function clampInterval(value, min = 1000, max = 86400000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cap(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export class DaemonManager {
  constructor({ toolRuntime = null, memoryStore = null, workspaceRoot = null } = {}) {
    this.toolRuntime = toolRuntime;
    this.memoryStore = memoryStore;
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.daemons = new Map();
    this.watchers = new Map(); // fs.FSWatcher instances
    this.timers = new Map(); // setInterval handles
    this.processes = new Map(); // ChildProcess instances
    this.healthTimer = null;
    this.maxDaemons = 50;
    this._hydrate();
  }

  // ─── Persistence ───────────────────────────────────────────────
  _statePath() {
    return `${this.workspaceRoot}/tmp/daemon-manager-state.json`;
  }

  _hydrate() {
    try {
      const raw = fs.readFileSync(this._statePath(), 'utf8');
      const state = JSON.parse(raw);
      if (!state || !Array.isArray(state.daemons)) return;
      for (const d of state.daemons) {
        if (d.state === 'running') {
          d.state = 'stale'; // Mark running daemons as stale after restart
        }
        this.daemons.set(d.id, d);
      }
    } catch (_) {
      // No state file — fresh start
    }
  }

  _persist() {
    try {
      fs.mkdirSync(`${this.workspaceRoot}/tmp`, { recursive: true });
      const snapshot = {
        savedAt: nowIso(),
        daemons: Array.from(this.daemons.values())
      };
      fs.writeFileSync(this._statePath(), JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (_) {
      // Best effort
    }
  }

  // ─── Health Loop ───────────────────────────────────────────────
  startHealthLoop() {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      this._healthCheck();
    }, 10000); // Every 10s
  }

  stopHealthLoop() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  async _healthCheck() {
    for (const [id, daemon] of this.daemons) {
      if (daemon.state !== 'running') continue;

      if (daemon.type === 'process') {
        const proc = this.processes.get(id);
        if (!proc || proc.killed) {
          daemon.state = 'failed';
          daemon.failures = (daemon.failures || 0) + 1;
          daemon.lastFailedAt = nowIso();

          if (daemon.autoRestart && daemon.failures < (daemon.maxRestarts || 3)) {
            daemon.state = 'starting';
            this._persist();
            try {
              await this._startProcessDaemon(daemon);
            } catch (_) {
              daemon.state = 'failed';
            }
          }
          this._persist();
        }
      }

      if (daemon.type === 'http_monitor') {
        // HTTP monitoring is handled by the tick loop
        continue;
      }

      if (daemon.type === 'file_watcher') {
        const watcher = this.watchers.get(id);
        if (!watcher) {
          daemon.state = 'failed';
          daemon.failures = (daemon.failures || 0) + 1;
          this._persist();
        }
      }
    }
  }

  // ─── Core API ──────────────────────────────────────────────────

  async startDaemon(config = {}) {
    const type = normalizeType(config.type);
    if (!type) {
      return { ok: false, error: `invalid type. Must be one of: ${VALID_TYPES.join(', ')}` };
    }

    if (this.daemons.size >= this.maxDaemons) {
      return { ok: false, error: `max daemons (${this.maxDaemons}) reached` };
    }

    const id = config.id || uid();
    const existing = this.daemons.get(id);
    if (existing && existing.state === 'running') {
      return { ok: false, error: `daemon ${id} is already running`, daemon: existing };
    }

    const daemon = {
      id,
      name: config.name || `${type}-${id.slice(0, 8)}`,
      type,
      state: 'starting',
      config: this._extractTypeConfig(type, config),
      createdAt: existing?.createdAt || nowIso(),
      startedAt: null,
      stoppedAt: null,
      failures: existing?.failures || 0,
      lastFailedAt: existing?.lastFailedAt || null,
      restarts: existing?.restarts || 0,
      maxRestarts: cap(config.maxRestarts, 0, 100, 3),
      autoRestart: config.autoRestart !== false,
      events: existing?.events || [],
      metadata: config.metadata || {}
    };

    this.daemons.set(id, daemon);

    try {
      if (type === 'file_watcher') {
        await this._startFileWatcher(daemon);
      } else if (type === 'process') {
        await this._startProcessDaemon(daemon);
      } else if (type === 'http_monitor') {
        this._startHttpMonitor(daemon);
      }

      daemon.state = 'running';
      daemon.startedAt = nowIso();
      daemon.failures = 0;
      this._recordEvent(daemon, 'started');
      this._persist();
      return { ok: true, daemon: this._sanitizeDaemon(daemon) };
    } catch (err) {
      daemon.state = 'failed';
      daemon.failures++;
      daemon.lastFailedAt = nowIso();
      this._recordEvent(daemon, 'start_failed', { error: String(err.message || err) });
      this._persist();
      return { ok: false, error: String(err.message || err), daemon: this._sanitizeDaemon(daemon) };
    }
  }

  async stopDaemon(id) {
    const daemon = this.daemons.get(id);
    if (!daemon) return { ok: false, error: 'daemon not found' };

    // Cleanup watchers
    const watcher = this.watchers.get(id);
    if (watcher) {
      try { watcher.close(); } catch (_) {}
      this.watchers.delete(id);
    }

    // Cleanup timers
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }

    // Cleanup processes
    const proc = this.processes.get(id);
    if (proc && !proc.killed) {
      try {
        proc.kill('SIGTERM');
        // Force kill after 5s
        setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch (_) {}
        }, 5000);
      } catch (_) {}
      this.processes.delete(id);
    }

    daemon.state = 'stopped';
    daemon.stoppedAt = nowIso();
    this._recordEvent(daemon, 'stopped');
    this._persist();
    return { ok: true, daemon: this._sanitizeDaemon(daemon) };
  }

  async restartDaemon(id) {
    const daemon = this.daemons.get(id);
    if (!daemon) return { ok: false, error: 'daemon not found' };

    await this.stopDaemon(id);
    daemon.state = 'starting';
    daemon.restarts++;
    this._persist();

    return this.startDaemon({
      id: daemon.id,
      name: daemon.name,
      type: daemon.type,
      ...daemon.config,
      metadata: daemon.metadata
    });
  }

  getDaemon(id) {
    const daemon = this.daemons.get(id);
    if (!daemon) return { ok: false, error: 'daemon not found' };
    return { ok: true, daemon: this._sanitizeDaemon(daemon) };
  }

  listDaemons({ type = null, state = null, limit = 50 } = {}) {
    let daemons = Array.from(this.daemons.values());
    if (type) daemons = daemons.filter(d => d.type === normalizeType(type));
    if (state) daemons = daemons.filter(d => d.state === normalizeState(state));
    daemons.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    daemons = daemons.slice(0, cap(limit, 1, 200, 50));
    return {
      ok: true,
      count: daemons.length,
      total: this.daemons.size,
      daemons: daemons.map(d => this._sanitizeDaemon(d))
    };
  }

  removeDaemon(id) {
    const daemon = this.daemons.get(id);
    if (!daemon) return { ok: false, error: 'daemon not found' };

    if (daemon.state === 'running') {
      return { ok: false, error: 'stop the daemon before removing it' };
    }

    this.daemons.delete(id);
    this._persist();
    return { ok: true, removed: id };
  }

  getStats() {
    const daemons = Array.from(this.daemons.values());
    const byType = {};
    const byState = {};
    for (const d of daemons) {
      byType[d.type] = (byType[d.type] || 0) + 1;
      byState[d.state] = (byState[d.state] || 0) + 1;
    }
    return {
      ok: true,
      total: daemons.length,
      byType,
      byState,
      watchers: this.watchers.size,
      processes: this.processes.size,
      timers: this.timers.size
    };
  }

  async destroy() {
    for (const [id] of this.daemons) {
      await this.stopDaemon(id);
    }
    this.stopHealthLoop();
  }

  // ─── File Watcher ──────────────────────────────────────────────

  async _startFileWatcher(daemon) {
    const { path: watchPath, recursive = true, events = ['change', 'add', 'unlink'], debounceMs = 500 } = daemon.config;

    if (!watchPath) throw new Error('file_watcher requires config.path');

    try {
      fs.accessSync(watchPath);
    } catch (_) {
      // Try to create directory if it looks like a directory path
      if (!watchPath.includes('.') || watchPath.endsWith('/')) {
        fs.mkdirSync(watchPath, { recursive: true });
      } else {
        throw new Error(`path does not exist: ${watchPath}`);
      }
    }

    let debounceTimer = null;
    const pendingEvents = [];

    const watcher = fs.watch(watchPath, { recursive }, (eventType, filename) => {
      const event = {
        type: eventType,
        filename: filename || null,
        timestamp: nowIso()
      };

      if (!events.includes(eventType) && !events.includes('*')) return;

      pendingEvents.push(event);

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const batch = pendingEvents.splice(0);
        this._recordEvent(daemon, 'file_events', {
          count: batch.length,
          events: batch.slice(0, 20) // Cap at 20 for readability
        });
        this._persist();
      }, debounceMs);
    });

    watcher.on('error', (err) => {
      daemon.state = 'failed';
      daemon.failures++;
      daemon.lastFailedAt = nowIso();
      this._recordEvent(daemon, 'watcher_error', { error: String(err.message || err) });
      this._persist();
    });

    this.watchers.set(daemon.id, watcher);
  }

  // ─── Process Daemon ────────────────────────────────────────────

  async _startProcessDaemon(daemon) {
    const { command, args = [], cwd, env = {}, shell = true, stdio = 'pipe' } = daemon.config;

    if (!command) throw new Error('process daemon requires config.command');

    const childEnv = { ...process.env, ...env };
    const childCwd = cwd || this.workspaceRoot;

    const proc = spawn(command, args, {
      cwd: childCwd,
      env: childEnv,
      shell,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const maxLogBuffer = 10000; // 10KB

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > maxLogBuffer) stdout = stdout.slice(-maxLogBuffer);
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > maxLogBuffer) stderr = stderr.slice(-maxLogBuffer);
    });

    proc.on('close', (code) => {
      this.processes.delete(daemon.id);
      if (daemon.state === 'running') {
        daemon.state = code === 0 ? 'stopped' : 'failed';
        if (daemon.state === 'failed') {
          daemon.failures++;
          daemon.lastFailedAt = nowIso();
        }
        this._recordEvent(daemon, 'process_exit', { code, stdout: stdout.slice(-500), stderr: stderr.slice(-500) });

        // Auto-restart
        if (daemon.autoRestart && daemon.state === 'failed' && daemon.failures < (daemon.maxRestarts || 3)) {
          daemon.state = 'starting';
          daemon.restarts++;
          this._persist();
          setTimeout(() => {
            this._startProcessDaemon(daemon).then(() => {
              daemon.state = 'running';
              daemon.startedAt = nowIso();
              this._recordEvent(daemon, 'auto_restarted');
              this._persist();
            }).catch((err) => {
              daemon.state = 'failed';
              this._recordEvent(daemon, 'auto_restart_failed', { error: String(err.message || err) });
              this._persist();
            });
          }, 1000);
          return;
        }
        this._persist();
      }
    });

    proc.on('error', (err) => {
      this.processes.delete(daemon.id);
      daemon.state = 'failed';
      daemon.failures++;
      daemon.lastFailedAt = nowIso();
      this._recordEvent(daemon, 'process_error', { error: String(err.message || err) });
      this._persist();
    });

    this.processes.set(daemon.id, proc);

    // Wait briefly for process to start
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Process didn't crash in first 2s — assume it's OK
        if (proc.killed) {
          reject(new Error('process died during startup'));
        } else {
          resolve();
        }
      }, 2000);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`process exited with code ${code}`));
        }
      });
    });
  }

  // ─── HTTP Monitor ──────────────────────────────────────────────

  _startHttpMonitor(daemon) {
    const { url, intervalMs = 30000, timeoutMs = 5000, expectedStatus = 200 } = daemon.config;

    if (!url) throw new Error('http_monitor requires config.url');

    const interval = clampInterval(intervalMs);
    if (!interval) throw new Error('http_monitor requires valid intervalMs');

    const timer = setInterval(async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 30000));

        const resp = await fetch(url, {
          method: 'GET',
          signal: controller.signal
        });
        clearTimeout(timeout);

        const healthy = resp.status === expectedStatus;
        daemon.lastCheck = nowIso();
        daemon.lastStatus = resp.status;
        daemon.lastHealthy = healthy;

        if (!healthy) {
          daemon.failures++;
          daemon.lastFailedAt = nowIso();
          this._recordEvent(daemon, 'health_unhealthy', {
            status: resp.status,
            expected: expectedStatus
          });
        } else {
          // Reset failures on healthy check
          if (daemon.failures > 0) {
            daemon.failures = 0;
            this._recordEvent(daemon, 'health_recovered');
          }
        }
        this._persist();
      } catch (err) {
        daemon.failures++;
        daemon.lastCheck = nowIso();
        daemon.lastHealthy = false;
        daemon.lastFailedAt = nowIso();
        this._recordEvent(daemon, 'health_error', { error: String(err.message || err) });
        this._persist();
      }
    }, interval);

    this.timers.set(daemon.id, timer);
  }

  // ─── Helpers ───────────────────────────────────────────────────

  _extractTypeConfig(type, config) {
    if (type === 'file_watcher') {
      return {
        path: config.path || config.watchPath,
        recursive: config.recursive !== false,
        events: Array.isArray(config.events) ? config.events : ['change', 'add', 'unlink'],
        debounceMs: clampInterval(config.debounceMs || 500, 50, 30000)
      };
    }
    if (type === 'process') {
      return {
        command: config.command || config.cmd,
        args: Array.isArray(config.args) ? config.args : [],
        cwd: config.cwd || null,
        env: config.env && typeof config.env === 'object' ? config.env : {},
        shell: config.shell !== false,
        stdio: config.stdio || 'pipe'
      };
    }
    if (type === 'http_monitor') {
      return {
        url: config.url || config.endpoint,
        intervalMs: clampInterval(config.intervalMs || config.interval || 30000),
        timeoutMs: clampInterval(config.timeoutMs || config.timeout || 5000, 1000, 60000),
        expectedStatus: cap(config.expectedStatus || config.status || 200, 100, 599, 200)
      };
    }
    return config;
  }

  _recordEvent(daemon, event, data = {}) {
    if (!daemon.events) daemon.events = [];
    daemon.events.push({
      event,
      timestamp: nowIso(),
      ...data
    });
    // Keep last 100 events
    if (daemon.events.length > 100) {
      daemon.events = daemon.events.slice(-100);
    }
  }

  _sanitizeDaemon(daemon) {
    const d = { ...daemon };
    // Remove internal fields
    delete d.config?.env; // Don't leak env vars
    return d;
  }
}
