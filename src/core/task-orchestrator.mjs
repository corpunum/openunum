import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function cap(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function summarizeResult(result) {
  const r = result || {};
  return {
    ok: Boolean(r.ok),
    error: r.error ? String(r.error) : null,
    status: Number.isFinite(r.status) ? r.status : null,
    code: Number.isFinite(r.code) ? r.code : null,
    path: r.path || r.outPath || null,
    id: r.id || r.run?.id || r.worker?.id || r.mission?.id || null
  };
}

function normalizePlan(plan = [], steps = []) {
  if (Array.isArray(plan) && plan.length > 0) {
    return plan.map((item, index) => ({
      index,
      text: trimString(typeof item === 'string' ? item : item?.text || item?.label || ''),
      status: 'pending'
    })).filter((item) => item.text);
  }
  return steps.map((step, index) => ({
    index,
    text: trimString(step?.label || step?.goal || `${step?.kind || 'step'}:${step?.tool || ''}`),
    status: 'pending'
  }));
}

function normalizeStep(raw = {}) {
  return {
    kind: trimString(raw.kind || raw.type).toLowerCase(),
    label: trimString(raw.label || raw.goal),
    tool: trimString(raw.tool),
    args: raw && typeof raw.args === 'object' && raw.args != null ? raw.args : {},
    payload: raw && typeof raw.payload === 'object' && raw.payload != null ? raw.payload : {},
    goal: trimString(raw.goal),
    ms: cap(raw.ms, 0, 86400000, 0),
    timeoutMs: cap(raw.timeoutMs, 1000, 86400000, 60000),
    pollMs: cap(raw.pollMs, 100, 60000, 500),
    allowedTools: Array.isArray(raw.allowedTools) ? raw.allowedTools.map((item) => trimString(item)).filter(Boolean) : []
  };
}

function normalizeCheck(raw = {}) {
  return {
    kind: trimString(raw.kind || raw.type).toLowerCase(),
    label: trimString(raw.label || raw.kind || raw.type),
    url: trimString(raw.url),
    expectStatus: Number.isFinite(Number(raw.expectStatus)) ? Number(raw.expectStatus) : 200,
    bodyIncludes: trimString(raw.bodyIncludes),
    path: trimString(raw.path),
    contains: trimString(raw.contains),
    key: trimString(raw.key),
    valueIncludes: trimString(raw.valueIncludes),
    stepIndex: Number.isFinite(Number(raw.stepIndex)) ? Number(raw.stepIndex) : null
  };
}

function isTerminalMissionStatus(status) {
  return ['completed', 'failed', 'stopped', 'hard_cap_reached', 'max_steps_reached'].includes(String(status || ''));
}

export class TaskOrchestrator {
  constructor({
    toolRuntime,
    memoryStore,
    missions,
    workerOrchestrator,
    selfEditPipeline,
    modelScoutWorkflow,
    planner,
    workspaceRoot
  }) {
    this.toolRuntime = toolRuntime;
    this.memoryStore = memoryStore;
    this.missions = missions;
    this.workerOrchestrator = workerOrchestrator;
    this.selfEditPipeline = selfEditPipeline;
    this.modelScoutWorkflow = modelScoutWorkflow;
    this.planner = planner;
    this.workspaceRoot = workspaceRoot;
    this.tasks = new Map();
    this.memoryStore?.markRunningTasksInterrupted?.();
  }

  buildPublicTask(task) {
    return {
      id: task.id,
      goal: task.goal,
      status: task.status,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      sessionId: task.sessionId,
      planning: task.planning || null,
      plan: task.plan.map((item) => ({ ...item })),
      steps: task.steps.map((item, index) => ({
        index,
        kind: item.kind,
        label: item.label,
        tool: item.tool || null,
        goal: item.goal || null
      })),
      stepResults: task.stepResults.map((item) => ({ ...item })),
      verification: task.verification.map((item) => ({ ...item })),
      monitoring: task.monitoring.map((item) => ({ ...item })),
      errors: [...task.errors]
    };
  }

  listTasks(limit = 40) {
    const live = [...this.tasks.values()].map((task) => this.buildPublicTask(task));
    const persisted = this.memoryStore?.listTaskRecords
      ? this.memoryStore.listTaskRecords(cap(limit, 1, 200, 40) * 3).map((task) => this.buildPublicTask(task))
      : [];
    const seen = new Set();
    const rows = [...live, ...persisted]
      .filter((task) => {
        if (!task?.id || seen.has(task.id)) return false;
        seen.add(task.id);
        return true;
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, cap(limit, 1, 200, 40));
    return { ok: true, tasks: rows };
  }

  getTask(id) {
    const task = this.tasks.get(trimString(id));
    if (task) return { ok: true, task: this.buildPublicTask(task) };
    const persisted = this.memoryStore?.getTaskRecord ? this.memoryStore.getTaskRecord(id) : null;
    if (!persisted) return { ok: false, error: 'task_not_found' };
    return { ok: true, task: this.buildPublicTask(persisted) };
  }

  validatePayload(payload = {}) {
    const goal = trimString(payload.goal);
    if (!goal) return { ok: false, error: 'goal is required' };
    const steps = Array.isArray(payload.steps) ? payload.steps.map(normalizeStep) : [];
    if (!steps.length) return { ok: false, error: 'steps is required' };
    const invalid = steps.filter((step) => !['tool', 'mission', 'worker', 'self_edit', 'model_scout', 'delay'].includes(step.kind));
    if (invalid.length) return { ok: false, error: `unsupported step kind: ${invalid[0].kind}` };
    const toolStepsMissingTool = steps.filter((step) => step.kind === 'tool' && !step.tool);
    if (toolStepsMissingTool.length) return { ok: false, error: 'tool steps require tool' };
    return { ok: true, goal, steps };
  }

  persistTask(task) {
    this.memoryStore?.persistTaskState?.(task);
  }

  resolvePayload(payload = {}) {
    if (Array.isArray(payload.steps) && payload.steps.length > 0) return { ok: true, payload };
    if (!this.planner?.plan) return { ok: false, error: 'steps is required' };
    return this.planner.plan(payload);
  }

  async executeMissionStep(task, step) {
    const started = this.missions.start({
      goal: step.goal || step.payload.goal || task.goal,
      maxSteps: step.payload.maxSteps,
      intervalMs: step.payload.intervalMs,
      maxRetries: step.payload.maxRetries,
      continueUntilDone: step.payload.continueUntilDone,
      hardStepCap: step.payload.hardStepCap,
      sessionId: trimString(step.payload.sessionId, task.sessionId)
    });
    const missionId = started.id;
    const deadline = Date.now() + step.timeoutMs;
    let mission = this.missions.get(missionId);
    while (Date.now() < deadline) {
      mission = this.missions.get(missionId);
      if (mission && isTerminalMissionStatus(mission.status)) {
        return {
          ok: mission.status === 'completed',
          id: mission.id,
          mission: {
            id: mission.id,
            status: mission.status,
            step: mission.step,
            finishedAt: mission.finishedAt || null
          },
          error: mission.status === 'completed' ? null : mission.error || mission.status
        };
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(step.pollMs);
    }
    const latest = this.missions.get(missionId);
    return {
      ok: false,
      id: missionId,
      mission: latest ? { id: latest.id, status: latest.status, step: latest.step } : null,
      error: 'mission_timeout'
    };
  }

  async executeWorkerStep(step) {
    const started = this.workerOrchestrator.startWorker(step.payload || {});
    if (!started.ok) return started;
    const workerId = started.worker.id;
    const ticked = await this.workerOrchestrator.tickWorker(workerId);
    return {
      ok: Boolean(ticked?.execution?.ok),
      worker: ticked.worker,
      execution: ticked.execution,
      id: workerId,
      error: ticked?.execution?.error || null
    };
  }

  async executeStep(task, step, index) {
    task.plan[index] = { ...(task.plan[index] || { index, text: step.label || `${step.kind}:${step.tool || ''}` }), status: 'running' };
    let out;
    if (step.kind === 'tool') {
      out = await this.toolRuntime.run(step.tool, step.args || {}, {
        sessionId: task.sessionId,
        allowedTools: step.allowedTools.length ? step.allowedTools : [step.tool],
        policyMode: 'execute'
      });
    } else if (step.kind === 'mission') {
      out = await this.executeMissionStep(task, step);
    } else if (step.kind === 'worker') {
      out = await this.executeWorkerStep(step);
    } else if (step.kind === 'self_edit') {
      out = await this.selfEditPipeline.run(step.payload || {});
    } else if (step.kind === 'model_scout') {
      out = await this.modelScoutWorkflow.run(step.payload || {});
    } else if (step.kind === 'delay') {
      await sleep(step.ms);
      out = { ok: true, waitedMs: step.ms };
    } else {
      out = { ok: false, error: `unsupported_step_kind:${step.kind}` };
    }
    const summary = {
      index,
      kind: step.kind,
      label: step.label || null,
      tool: step.tool || null,
      result: summarizeResult(out),
      raw: out
    };
    task.stepResults.push(summary);
    task.plan[index] = { ...(task.plan[index] || { index, text: step.label || `${step.kind}:${step.tool || ''}` }), status: out?.ok ? 'completed' : 'failed' };
    if (!out?.ok) task.errors.push(summary.result.error || `${step.kind}_failed`);
    this.persistTask(task);
    return out;
  }

  async runCheck(task, rawCheck, collection) {
    const check = normalizeCheck(rawCheck);
    let out = { ok: false, error: 'unsupported_check' };
    if (check.kind === 'http') {
      try {
        const res = await fetch(check.url);
        const body = await res.text();
        out = {
          ok: res.status === check.expectStatus && (!check.bodyIncludes || body.includes(check.bodyIncludes)),
          status: res.status,
          error: null,
          bodySnippet: body.slice(0, 240)
        };
      } catch (error) {
        out = { ok: false, error: String(error.message || error) };
      }
    } else if (check.kind === 'file_contains') {
      try {
        const target = path.resolve(this.workspaceRoot, check.path);
        const content = fs.readFileSync(target, 'utf8');
        out = { ok: content.includes(check.contains), error: null, path: target };
      } catch (error) {
        out = { ok: false, error: String(error.message || error) };
      }
    } else if (check.kind === 'fact_exists') {
      const facts = this.memoryStore?.listFacts ? this.memoryStore.listFacts({ limit: 500 }) : [];
      const matched = facts.find((item) =>
        String(item.key || '') === check.key &&
        (!check.valueIncludes || String(item.value || '').includes(check.valueIncludes))
      );
      out = { ok: Boolean(matched), error: matched ? null : 'fact_not_found', fact: matched || null };
    } else if (check.kind === 'step_ok') {
      const stepResult = task.stepResults.find((item) => item.index === check.stepIndex);
      out = { ok: Boolean(stepResult?.result?.ok), error: stepResult ? null : 'step_not_found' };
    }
    collection.push({
      kind: check.kind,
      label: check.label,
      target: check.url || check.path || check.key || check.stepIndex,
      ...out
    });
    this.persistTask(task);
    return out;
  }

  recordArtifacts(task) {
    if (this.memoryStore?.addMemoryArtifact) {
      this.memoryStore.addMemoryArtifact({
        sessionId: task.sessionId,
        artifactType: 'autonomy_task',
        content: JSON.stringify(this.buildPublicTask(task)),
        sourceRef: task.id
      });
    }
    if (this.memoryStore?.recordStrategyOutcome) {
      this.memoryStore.recordStrategyOutcome({
        goal: task.goal,
        strategy: 'generic_task_orchestrator',
        success: task.status === 'completed',
        evidence: `${task.status} steps=${task.stepResults.length} verification=${task.verification.length}`
      });
    }
  }

  async runTask(payload = {}) {
    const resolved = this.resolvePayload(payload);
    if (!resolved.ok) return resolved;
    const effectivePayload = resolved.payload || payload;
    const validated = this.validatePayload(effectivePayload);
    if (!validated.ok) return validated;
    const id = crypto.randomUUID();
    const task = {
      id,
      goal: validated.goal,
      status: 'running',
      createdAt: nowIso(),
      startedAt: nowIso(),
      finishedAt: null,
      sessionId: trimString(effectivePayload.sessionId, `task:${id}`),
      continueOnFailure: effectivePayload.continueOnFailure === true,
      planning: effectivePayload.planning || null,
      steps: validated.steps,
      plan: normalizePlan(effectivePayload.plan, validated.steps),
      stepResults: [],
      verification: [],
      monitoring: [],
      errors: []
    };
    this.tasks.set(id, task);
    this.persistTask(task);
    try {
      for (let i = 0; i < task.steps.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const out = await this.executeStep(task, task.steps[i], i);
        if (!out?.ok && effectivePayload.continueOnFailure !== true) {
          task.status = 'failed';
          task.finishedAt = nowIso();
          this.recordArtifacts(task);
          this.persistTask(task);
          return { ok: false, task: this.buildPublicTask(task) };
        }
      }
      const verifyChecks = Array.isArray(effectivePayload.verify) ? effectivePayload.verify : [];
      for (const check of verifyChecks) {
        // eslint-disable-next-line no-await-in-loop
        const out = await this.runCheck(task, check, task.verification);
        if (!out.ok) {
          task.status = 'failed';
          task.finishedAt = nowIso();
          this.recordArtifacts(task);
          this.persistTask(task);
          return { ok: false, task: this.buildPublicTask(task) };
        }
      }
      const monitorChecks = Array.isArray(effectivePayload.monitor) ? effectivePayload.monitor : [];
      for (const check of monitorChecks) {
        // eslint-disable-next-line no-await-in-loop
        await this.runCheck(task, check, task.monitoring);
      }
      task.status = 'completed';
    } catch (error) {
      task.status = 'failed';
      task.errors.push(String(error.message || error));
    } finally {
      task.finishedAt = nowIso();
      this.recordArtifacts(task);
      this.persistTask(task);
      if (task.status !== 'running') this.tasks.delete(task.id);
    }
    return { ok: task.status === 'completed', task: this.buildPublicTask(task) };
  }
}
