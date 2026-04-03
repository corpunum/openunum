import crypto from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function cap(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

function summarizeToolResult(result) {
  const r = result || {};
  return {
    ok: Boolean(r.ok),
    error: r.error ? String(r.error) : null,
    code: Number.isFinite(r.code) ? r.code : null,
    status: Number.isFinite(r.status) ? r.status : null,
    path: r.path || r.outPath || null,
    stdout: typeof r.stdout === 'string' ? r.stdout.slice(0, 400) : '',
    stderr: typeof r.stderr === 'string' ? r.stderr.slice(0, 400) : ''
  };
}

function trimString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeEditStep(raw = {}) {
  const tool = trimString(raw.tool || raw.name);
  const args = raw && typeof raw.args === 'object' && raw.args != null ? { ...raw.args } : {};
  return { tool, args };
}

function summarizeCanary(out) {
  return {
    ok: Boolean(out.ok),
    url: out.url,
    status: Number.isFinite(out.status) ? out.status : null,
    error: out.error ? String(out.error) : null,
    bodySnippet: typeof out.bodySnippet === 'string' ? out.bodySnippet : ''
  };
}

function defaultCanaryChecks(baseUrl, changedPaths = []) {
  const paths = Array.isArray(changedPaths) ? changedPaths : [];
  const touchesRuntimeSurface = paths.some((item) => /^(src\/|scripts\/|package\.json|src\/ui\/index\.html)/.test(String(item || '')));
  if (!touchesRuntimeSurface) return [];
  return [
    { name: 'health', url: `${baseUrl}/api/health`, expectStatus: 200 },
    { name: 'runtime-overview', url: `${baseUrl}/api/runtime/overview`, expectStatus: 200 }
  ];
}

function defaultValidationCommands(baseUrl, changedPaths = []) {
  const commands = [];
  const uniquePaths = [...new Set((changedPaths || []).map((item) => trimString(item)).filter(Boolean))];
  for (const file of uniquePaths) {
    if (/\.(mjs|js|cjs)$/.test(file)) {
      commands.push(`node --check ${shellQuote(file)}`);
    }
  }
  if (uniquePaths.some((item) => /^(src\/|scripts\/|package\.json|src\/ui\/index\.html)/.test(item))) {
    commands.push(`OPENUNUM_BASE_URL=${shellQuote(baseUrl)} node scripts/ui-smoke-noauth.mjs`);
  }
  return [...new Set(commands)];
}

function buildPromotionPolicy(baseUrl, changedPaths = [], validationCommands = [], canaryChecks = []) {
  const paths = [...new Set((changedPaths || []).map((item) => trimString(item)).filter(Boolean))];
  const touchesRuntimeCode = paths.some((item) => /^(src\/|scripts\/|package\.json)/.test(item));
  const touchesUi = paths.some((item) => item === 'src/ui/index.html' || /\/src\/ui\/index\.html$/.test(item));
  const touchesDocsOnly = paths.length > 0 && paths.every((item) => /^(docs\/|README|CHANGELOG|NEXT_TASKS\.md)/.test(item));
  const requiredValidationSubstrings = [];
  const requiredCanaryTargets = [];
  if (touchesRuntimeCode) requiredValidationSubstrings.push('node --check');
  if (touchesUi) requiredValidationSubstrings.push('scripts/ui-smoke-noauth.mjs');
  if (touchesRuntimeCode || touchesUi) requiredCanaryTargets.push(`${baseUrl}/api/health`);
  return {
    touchesRuntimeCode,
    touchesUi,
    touchesDocsOnly,
    requiredValidationSubstrings,
    requiredCanaryTargets,
    declaredValidationCommands: [...validationCommands],
    declaredCanaryUrls: canaryChecks.map((item) => trimString(item?.url)).filter(Boolean)
  };
}

function evaluatePromotionPolicy(policy) {
  if (!policy) return { ok: true, violations: [] };
  if (policy.touchesDocsOnly) return { ok: true, violations: [] };
  const violations = [];
  for (const needle of policy.requiredValidationSubstrings || []) {
    if (!policy.declaredValidationCommands.some((cmd) => String(cmd || '').includes(needle))) {
      violations.push(`missing_required_validation:${needle}`);
    }
  }
  for (const url of policy.requiredCanaryTargets || []) {
    if (!policy.declaredCanaryUrls.some((item) => item === url)) {
      violations.push(`missing_required_canary:${url}`);
    }
  }
  return { ok: violations.length === 0, violations };
}

export class SelfEditPipeline {
  constructor({ toolRuntime, memoryStore, workspaceRoot, defaultBaseUrl = 'http://127.0.0.1:18880' }) {
    this.toolRuntime = toolRuntime;
    this.memoryStore = memoryStore;
    this.workspaceRoot = workspaceRoot;
    this.defaultBaseUrl = trimString(defaultBaseUrl, 'http://127.0.0.1:18880');
    this.runs = new Map();
    this.memoryStore?.markRunningSelfEditInterrupted?.();
  }

  buildPublicRun(run) {
    return {
      id: run.id,
      label: run.label,
      goal: run.goal,
      status: run.status,
      sessionId: run.sessionId,
      baseUrl: run.baseUrl,
      changedPaths: [...run.changedPaths],
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      promotedAt: run.promotedAt,
      rolledBackAt: run.rolledBackAt,
      rollbackOnFailure: run.rollbackOnFailure,
      promotionPolicy: run.promotionPolicy ? { ...run.promotionPolicy } : null,
      promotionChecks: Array.isArray(run.promotionChecks) ? [...run.promotionChecks] : [],
      validationCommands: [...run.validationCommands],
      canaryChecks: run.canaryChecks.map((item) => ({ ...item })),
      edits: run.edits.map((item) => ({ tool: item.tool, args: item.args })),
      editResults: run.editResults.map((item) => ({ ...item })),
      validationResults: run.validationResults.map((item) => ({ ...item })),
      canaryResults: run.canaryResults.map((item) => ({ ...item })),
      rollbackResults: run.rollbackResults.map((item) => ({ ...item })),
      lastError: run.lastError || null,
      proof: {
        validationsPassed: run.validationResults.filter((item) => item.ok).length,
        canariesPassed: run.canaryResults.filter((item) => item.ok).length,
        rollbackCount: run.rollbackResults.filter((item) => item.ok).length
      }
    };
  }

  listRuns(limit = 40) {
    const live = [...this.runs.values()];
    const persisted = this.memoryStore?.listSelfEditRecords?.(cap(limit, 1, 200, 40) * 3) || [];
    const seen = new Set();
    const rows = [...live, ...persisted]
      .filter((run) => {
        if (!run?.id || seen.has(run.id)) return false;
        seen.add(run.id);
        return true;
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, cap(limit, 1, 200, 40))
      .map((run) => this.buildPublicRun(run));
    return { ok: true, runs: rows };
  }

  getRun(id) {
    const run = this.runs.get(trimString(id));
    if (run) return { ok: true, run: this.buildPublicRun(run) };
    const persisted = this.memoryStore?.getSelfEditRecord?.(id);
    if (!persisted) return { ok: false, error: 'self_edit_run_not_found' };
    return { ok: true, run: this.buildPublicRun(persisted) };
  }

  persistRun(run) {
    this.memoryStore?.upsertSelfEditRecord?.(run);
  }

  validatePayload(payload = {}) {
    const edits = Array.isArray(payload.edits) ? payload.edits.map(normalizeEditStep) : [];
    if (!edits.length) return { ok: false, error: 'edits is required' };
    const invalidTools = edits.filter((item) => !['file_patch', 'file_write'].includes(item.tool));
    if (invalidTools.length) return { ok: false, error: 'edits may only use file_patch or file_write' };
    const missingPaths = edits.filter((item) => !trimString(item.args?.path));
    if (missingPaths.length) return { ok: false, error: 'each edit requires args.path' };
    const paths = edits.map((item) => trimString(item.args?.path));
    const duplicatePaths = paths.filter((item, index) => paths.indexOf(item) !== index);
    if (duplicatePaths.length) {
      return { ok: false, error: `duplicate edit paths are not allowed: ${[...new Set(duplicatePaths)].join(', ')}` };
    }
    return { ok: true, edits };
  }

  async runValidationCommand(run, cmd) {
    const result = await this.toolRuntime.run('shell_run', { cmd }, {
      sessionId: run.sessionId,
      allowedTools: ['shell_run'],
      policyMode: 'execute'
    });
    const summary = {
      command: cmd,
      ...summarizeToolResult(result)
    };
    run.validationResults.push(summary);
    if (!summary.ok) run.lastError = summary.error || `validation_failed:${cmd}`;
    return summary;
  }

  async runCanary(run, check = {}) {
    const url = trimString(check.url);
    const method = trimString(check.method || 'GET', 'GET').toUpperCase();
    const expectStatus = Number.isFinite(Number(check.expectStatus)) ? Number(check.expectStatus) : 200;
    try {
      const res = await fetch(url, { method });
      const raw = await res.text();
      const out = {
        name: trimString(check.name || url),
        ok: res.status === expectStatus,
        url,
        method,
        status: res.status,
        expectStatus,
        bodySnippet: raw.slice(0, 240)
      };
      run.canaryResults.push(summarizeCanary(out));
      if (!out.ok) run.lastError = `canary_failed:${url}`;
      return out;
    } catch (error) {
      const out = {
        name: trimString(check.name || url),
        ok: false,
        url,
        method,
        status: null,
        expectStatus,
        error: String(error.message || error),
        bodySnippet: ''
      };
      run.canaryResults.push(summarizeCanary(out));
      run.lastError = out.error;
      return out;
    }
  }

  async rollbackRun(run) {
    for (const path of [...run.changedPaths].reverse()) {
      const result = await this.toolRuntime.run('file_restore_last', { path }, {
        sessionId: run.sessionId,
        allowedTools: ['file_restore_last'],
        policyMode: 'execute'
      });
      run.rollbackResults.push({
        path,
        ...summarizeToolResult(result)
      });
    }
    run.rolledBackAt = nowIso();
    run.status = run.rollbackResults.every((item) => item.ok) ? 'rolled_back' : 'rollback_failed';
  }

  recordRunArtifacts(run) {
    if (this.memoryStore?.addMemoryArtifact) {
      this.memoryStore.addMemoryArtifact({
        sessionId: run.sessionId,
        artifactType: 'self_edit_run',
        content: JSON.stringify(this.buildPublicRun(run)),
        sourceRef: run.id
      });
    }
    if (this.memoryStore?.recordStrategyOutcome) {
      this.memoryStore.recordStrategyOutcome({
        goal: run.goal || run.label || 'self_edit',
        strategy: 'self_edit_pipeline',
        success: run.status === 'promoted',
        evidence: `${run.status} changed=${run.changedPaths.join(',')}`
      });
    }
    if (this.memoryStore?.rememberFact) {
      this.memoryStore.rememberFact('runtime.last_self_edit_status', run.status);
      this.memoryStore.rememberFact('runtime.last_self_edit_changed_paths', run.changedPaths.join(','));
    }
  }

  async run(payload = {}) {
    const validated = this.validatePayload(payload);
    if (!validated.ok) return validated;
    const edits = validated.edits;
    const id = crypto.randomUUID();
    const baseUrl = trimString(payload.baseUrl, this.defaultBaseUrl);
    const sessionId = trimString(payload.sessionId, `self-edit:${id}`);
    const validationCommands = Array.isArray(payload.validationCommands) && payload.validationCommands.length
      ? payload.validationCommands.map((item) => trimString(item)).filter(Boolean)
      : defaultValidationCommands(baseUrl, edits.map((item) => trimString(item.args?.path)));
    const rawCanaries = Array.isArray(payload.canaryChecks) && payload.canaryChecks.length
      ? payload.canaryChecks
      : defaultCanaryChecks(baseUrl, edits.map((item) => trimString(item.args?.path)));
    const canaryChecks = rawCanaries
      .map((item) => ({
        name: trimString(item?.name || item?.url || ''),
        method: trimString(item?.method || 'GET', 'GET').toUpperCase(),
        url: trimString(item?.url || ''),
        expectStatus: Number.isFinite(Number(item?.expectStatus)) ? Number(item.expectStatus) : 200
      }))
      .filter((item) => item.url);
    const promotionPolicy = buildPromotionPolicy(
      baseUrl,
      edits.map((item) => trimString(item.args?.path)),
      validationCommands,
      canaryChecks
    );
    const promotionChecks = [];

    const run = {
      id,
      label: trimString(payload.label, `self-edit-${id.slice(0, 8)}`),
      goal: trimString(payload.goal),
      status: 'running',
      sessionId,
      baseUrl,
      changedPaths: [],
      createdAt: nowIso(),
      startedAt: nowIso(),
      finishedAt: null,
      promotedAt: null,
      rolledBackAt: null,
      rollbackOnFailure: payload.rollbackOnFailure !== false,
      promotionPolicy,
      promotionChecks,
      validationCommands,
      canaryChecks,
      edits,
      editResults: [],
      validationResults: [],
      canaryResults: [],
      rollbackResults: [],
      lastError: null
    };
    this.runs.set(id, run);
    this.persistRun(run);

    try {
      for (const edit of edits) {
        const result = await this.toolRuntime.run(edit.tool, edit.args, {
          sessionId,
          allowedTools: ['file_patch', 'file_write', 'file_restore_last', 'shell_run'],
          policyMode: 'execute'
        });
        const summary = {
          tool: edit.tool,
          args: edit.args,
          ...summarizeToolResult(result)
        };
        run.editResults.push(summary);
        if (summary.path) run.changedPaths.push(edit.args.path);
        this.persistRun(run);
        if (!summary.ok) {
          run.lastError = summary.error || `edit_failed:${edit.tool}`;
          throw new Error(run.lastError);
        }
      }

      for (const command of validationCommands) {
        const out = await this.runValidationCommand(run, command);
        this.persistRun(run);
        if (!out.ok) throw new Error(run.lastError || `validation_failed:${command}`);
      }

      for (const check of canaryChecks) {
        const out = await this.runCanary(run, check);
        this.persistRun(run);
        if (!out.ok) throw new Error(run.lastError || `canary_failed:${check.url}`);
      }

      const policyEvaluation = evaluatePromotionPolicy(run.promotionPolicy);
      run.promotionChecks.push({
        at: nowIso(),
        ok: policyEvaluation.ok,
        violations: policyEvaluation.violations
      });
      this.persistRun(run);
      if (!policyEvaluation.ok) {
        run.lastError = policyEvaluation.violations.join(';');
        throw new Error(run.lastError);
      }

      run.status = 'promoted';
      run.promotedAt = nowIso();
    } catch (error) {
      run.lastError = trimString(error?.message || error, 'self_edit_failed');
      if (run.rollbackOnFailure && run.changedPaths.length > 0) {
        await this.rollbackRun(run);
      } else {
        run.status = 'failed';
      }
    } finally {
      run.finishedAt = nowIso();
      this.recordRunArtifacts(run);
      this.persistRun(run);
    }

    return { ok: run.status === 'promoted', run: this.buildPublicRun(run) };
  }
}
