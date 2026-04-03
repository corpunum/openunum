import crypto from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function summarizeToolResult(result) {
  const r = result || {};
  return {
    ok: Boolean(r.ok),
    error: r.error ? String(r.error) : null,
    code: Number.isFinite(r.code) ? r.code : null,
    status: Number.isFinite(r.status) ? r.status : null,
    path: r.path || r.outPath || null,
    url: r.url || null
  };
}

function normalizeToolName(name) {
  return String(name || '').trim();
}

function normalizeStep(rawStep = {}) {
  return {
    tool: normalizeToolName(rawStep.tool || rawStep.name),
    args: rawStep && typeof rawStep.args === 'object' && rawStep.args != null ? rawStep.args : {}
  };
}

function cap(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'scheduled') return 'scheduled';
  if (s === 'running') return 'running';
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  if (s === 'stopped') return 'stopped';
  return 'scheduled';
}

export class WorkerOrchestrator {
  constructor({ toolRuntime }) {
    this.toolRuntime = toolRuntime;
    this.workers = new Map();
    this.timer = null;
  }

  startLoop() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tickDueWorkers();
    }, 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopLoop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  getCatalogToolNames() {
    const tools = this.toolRuntime.toolCatalog ? this.toolRuntime.toolCatalog({}) : [];
    return new Set(tools.map((item) => normalizeToolName(item.name)).filter(Boolean));
  }

  buildPublicWorker(worker) {
    return {
      id: worker.id,
      name: worker.name,
      goal: worker.goal,
      status: worker.status,
      allowedTools: [...worker.allowedTools],
      steps: worker.steps.map((step, idx) => ({ index: idx, tool: step.tool, args: step.args })),
      maxStepsPerRun: worker.maxStepsPerRun,
      intervalMs: worker.intervalMs,
      maxRuns: worker.maxRuns,
      runCount: worker.runCount,
      failCount: worker.failCount,
      nextRunAt: worker.nextRunAt,
      lastStartedAt: worker.lastStartedAt,
      lastFinishedAt: worker.lastFinishedAt,
      createdAt: worker.createdAt,
      updatedAt: worker.updatedAt,
      lastError: worker.lastError || null,
      logs: [...worker.logs]
    };
  }

  listWorkers(limit = 80) {
    const rows = [...this.workers.values()]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, cap(limit, 1, 500, 80))
      .map((worker) => this.buildPublicWorker(worker));
    return { ok: true, workers: rows };
  }

  getWorker(id) {
    const worker = this.workers.get(String(id || '').trim());
    if (!worker) return { ok: false, error: 'worker_not_found' };
    return { ok: true, worker: this.buildPublicWorker(worker) };
  }

  startWorker(payload = {}) {
    const allowedTools = Array.isArray(payload.allowedTools)
      ? payload.allowedTools.map((name) => normalizeToolName(name)).filter(Boolean)
      : [];
    if (!allowedTools.length) {
      return { ok: false, error: 'allowedTools is required' };
    }
    const steps = Array.isArray(payload.steps) ? payload.steps.map(normalizeStep) : [];
    if (!steps.length) {
      return { ok: false, error: 'steps is required' };
    }
    const catalog = this.getCatalogToolNames();
    const invalidAllowed = allowedTools.filter((name) => !catalog.has(name));
    if (invalidAllowed.length) {
      return { ok: false, error: `unknown allowedTools: ${invalidAllowed.join(', ')}` };
    }
    const invalidSteps = steps.filter((step) => !step.tool || !allowedTools.includes(step.tool));
    if (invalidSteps.length) {
      return { ok: false, error: 'all step tools must be in allowedTools' };
    }

    const id = crypto.randomUUID();
    const now = nowIso();
    const delayMs = cap(payload.delayMs, 0, 365 * 24 * 60 * 60 * 1000, 0);
    const intervalMs = cap(payload.intervalMs, 0, 365 * 24 * 60 * 60 * 1000, 0);
    const worker = {
      id,
      name: String(payload.name || `worker-${id.slice(0, 8)}`),
      goal: String(payload.goal || ''),
      status: 'scheduled',
      allowedTools: [...new Set(allowedTools)],
      steps,
      maxStepsPerRun: cap(payload.maxStepsPerRun, 1, 200, steps.length),
      intervalMs,
      maxRuns: cap(payload.maxRuns, 1, 10000, intervalMs > 0 ? 1000 : 1),
      runCount: 0,
      failCount: 0,
      nextRunAt: new Date(Date.now() + delayMs).toISOString(),
      lastStartedAt: null,
      lastFinishedAt: null,
      createdAt: now,
      updatedAt: now,
      lastError: null,
      logs: []
    };
    this.workers.set(id, worker);
    this.startLoop();
    return { ok: true, worker: this.buildPublicWorker(worker) };
  }

  stopWorker(id) {
    const worker = this.workers.get(String(id || '').trim());
    if (!worker) return { ok: false, error: 'worker_not_found' };
    worker.status = 'stopped';
    worker.nextRunAt = null;
    worker.updatedAt = nowIso();
    worker.logs.push({
      at: worker.updatedAt,
      type: 'stop',
      note: 'stopped_by_request'
    });
    if (worker.logs.length > 200) worker.logs = worker.logs.slice(-200);
    return { ok: true, worker: this.buildPublicWorker(worker) };
  }

  async tickWorker(id) {
    const worker = this.workers.get(String(id || '').trim());
    if (!worker) return { ok: false, error: 'worker_not_found' };
    if (worker.status === 'running') return { ok: false, error: 'worker_already_running' };
    const out = await this.executeWorker(worker);
    return { ok: true, worker: this.buildPublicWorker(worker), execution: out };
  }

  async tickDueWorkers() {
    const due = [...this.workers.values()].filter((worker) => {
      if (worker.status !== 'scheduled') return false;
      if (!worker.nextRunAt) return false;
      return new Date(worker.nextRunAt).getTime() <= Date.now();
    });
    for (const worker of due) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.executeWorker(worker);
      } catch {
        // errors are captured in executeWorker state
      }
    }
  }

  async executeWorker(worker) {
    const startAt = nowIso();
    worker.status = 'running';
    worker.lastStartedAt = startAt;
    worker.updatedAt = startAt;
    worker.logs.push({
      at: startAt,
      type: 'run_start',
      run: worker.runCount + 1
    });

    const steps = worker.steps.slice(0, worker.maxStepsPerRun);
    const stepOutcomes = [];
    let success = true;
    let lastError = '';

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (!worker.allowedTools.includes(step.tool)) {
        success = false;
        lastError = `tool_not_allowed:${step.tool}`;
        stepOutcomes.push({
          index: i,
          tool: step.tool,
          ok: false,
          error: lastError
        });
        break;
      }
      let result;
      try {
        // eslint-disable-next-line no-await-in-loop
        result = await this.toolRuntime.run(step.tool, step.args || {}, {
          sessionId: `worker:${worker.id}`,
          allowedTools: worker.allowedTools,
          policyMode: 'execute'
        });
      } catch (error) {
        result = { ok: false, error: String(error.message || error) };
      }
      const summary = summarizeToolResult(result);
      stepOutcomes.push({
        index: i,
        tool: step.tool,
        args: step.args || {},
        result: summary
      });
      if (!summary.ok) {
        success = false;
        lastError = summary.error || `step_failed:${step.tool}`;
        break;
      }
    }

    const finishAt = nowIso();
    worker.lastFinishedAt = finishAt;
    worker.updatedAt = finishAt;
    worker.runCount += 1;
    if (!success) worker.failCount += 1;
    worker.lastError = success ? null : lastError;

    const shouldContinue = worker.intervalMs > 0 && worker.runCount < worker.maxRuns && worker.status !== 'stopped';
    if (worker.status === 'stopped') {
      worker.nextRunAt = null;
    } else if (shouldContinue) {
      worker.status = 'scheduled';
      worker.nextRunAt = new Date(Date.now() + worker.intervalMs).toISOString();
    } else {
      worker.status = success ? 'completed' : 'failed';
      worker.nextRunAt = null;
    }

    worker.logs.push({
      at: finishAt,
      type: 'run_finish',
      run: worker.runCount,
      ok: success,
      error: success ? null : lastError,
      steps: stepOutcomes
    });
    if (worker.logs.length > 200) worker.logs = worker.logs.slice(-200);

    return {
      ok: success,
      run: worker.runCount,
      status: worker.status,
      error: success ? null : lastError,
      steps: stepOutcomes
    };
  }
}
