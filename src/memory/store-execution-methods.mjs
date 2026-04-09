import { parseJson } from './store-helpers.mjs';

export class ExecutionStoreMethods {
  upsertMissionRecord(mission) {
    if (!mission || !mission.id) return;
    // Write to execution_state for v2.1.0+ (backward compat: also writes to mission_records)
    this.upsertExecutionState({ ...mission, type: 'mission' });
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO mission_records (
          id, goal, status, session_id, step, max_steps, hard_step_cap, retries, max_retries, interval_ms,
          continue_until_done, error, started_at, finished_at, updated_at, mission_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          goal = excluded.goal,
          status = excluded.status,
          session_id = excluded.session_id,
          step = excluded.step,
          max_steps = excluded.max_steps,
          hard_step_cap = excluded.hard_step_cap,
          retries = excluded.retries,
          max_retries = excluded.max_retries,
          interval_ms = excluded.interval_ms,
          continue_until_done = excluded.continue_until_done,
          error = excluded.error,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          updated_at = excluded.updated_at,
          mission_json = excluded.mission_json`
      )
      .run(
        String(mission.id),
        String(mission.goal || ''),
        String(mission.status || 'unknown'),
        String(mission.sessionId || ''),
        Number(mission.step || 0),
        Number(mission.maxSteps || 0),
        Number(mission.hardStepCap || 0),
        Number(mission.retries || 0),
        Number(mission.maxRetries || 0),
        Number(mission.intervalMs || 0),
        mission.continueUntilDone === false ? 0 : 1,
        mission.error ? String(mission.error) : null,
        String(mission.startedAt || now),
        mission.finishedAt ? String(mission.finishedAt) : null,
        now,
        JSON.stringify(mission || {})
      );
  }

  getMissionRecord(id) {
    const missionId = String(id || '').trim();
    if (!missionId) return null;
    const row = this.db
      .prepare(
        'SELECT mission_json FROM mission_records WHERE id = ?'
      )
      .get(missionId);
    if (!row) return null;
    try {
      return JSON.parse(row.mission_json || '{}');
    } catch {
      return null;
    }
  }

  listMissionRecords(limit = 80) {
    const rows = this.db
      .prepare(
        'SELECT mission_json FROM mission_records ORDER BY COALESCE(updated_at, started_at) DESC LIMIT ?'
      )
      .all(Math.max(1, Math.min(500, Number(limit || 80))));
    return rows
      .map((row) => {
        try {
          return JSON.parse(row.mission_json || '{}');
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  markRunningMissionsInterrupted() {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare('SELECT mission_json FROM mission_records WHERE status IN (\'running\', \'stopping\')')
      .all();
    for (const row of rows) {
      let mission = null;
      try {
        mission = JSON.parse(row.mission_json || '{}');
      } catch {
        mission = null;
      }
      if (!mission || !mission.id) continue;
      mission.status = 'interrupted';
      mission.error = mission.error || 'mission_interrupted_by_restart';
      mission.finishedAt = mission.finishedAt || now;
      this.upsertMissionRecord(mission);
    }
  }

  createMissionSchedule({
    id,
    goal,
    runAt,
    intervalMs = 0,
    enabled = true,
    options = {}
  }) {
    const now = new Date().toISOString();
    const scheduleId = String(id || '').trim();
    if (!scheduleId) throw new Error('schedule id is required');
    const payload = {
      id: scheduleId,
      goal: String(goal || ''),
      runAt: String(runAt || now),
      intervalMs: Math.max(0, Number(intervalMs || 0)),
      enabled: enabled !== false,
      status: 'scheduled',
      options: options || {},
      lastRunAt: null,
      nextRunAt: String(runAt || now),
      lastError: null,
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO mission_schedules (
          id, goal, run_at, interval_ms, enabled, status, options_json,
          last_run_at, next_run_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.id,
        payload.goal,
        payload.runAt,
        payload.intervalMs,
        payload.enabled ? 1 : 0,
        payload.status,
        JSON.stringify(payload.options || {}),
        null,
        payload.nextRunAt,
        null,
        payload.createdAt,
        payload.updatedAt
      );
    return payload;
  }

  listMissionSchedules(limit = 120) {
    const rows = this.db
      .prepare(
        `SELECT
          id, goal, run_at, interval_ms, enabled, status, options_json,
          last_run_at, next_run_at, last_error, created_at, updated_at
         FROM mission_schedules
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(Math.max(1, Math.min(500, Number(limit || 120))));
    return rows.map((row) => ({
      id: row.id,
      goal: row.goal,
      runAt: row.run_at,
      intervalMs: Number(row.interval_ms || 0),
      enabled: Boolean(row.enabled),
      status: row.status,
      options: JSON.parse(row.options_json || '{}'),
      lastRunAt: row.last_run_at || null,
      nextRunAt: row.next_run_at || null,
      lastError: row.last_error || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  updateMissionSchedule(id, changes = {}) {
    const scheduleId = String(id || '').trim();
    if (!scheduleId) throw new Error('schedule id is required');
    const current = this.listMissionSchedules(500).find((item) => item.id === scheduleId);
    if (!current) return null;
    const next = { ...current };
    for (const [key, value] of Object.entries(changes || {})) {
      if (value !== undefined) next[key] = value;
    }
    next.options = changes.options != null ? (changes.options || {}) : current.options;
    next.updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE mission_schedules
         SET goal = ?, run_at = ?, interval_ms = ?, enabled = ?, status = ?, options_json = ?,
             last_run_at = ?, next_run_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        String(next.goal || ''),
        String(next.runAt || current.runAt),
        Math.max(0, Number(next.intervalMs || 0)),
        next.enabled ? 1 : 0,
        String(next.status || 'scheduled'),
        JSON.stringify(next.options || {}),
        next.lastRunAt ? String(next.lastRunAt) : null,
        next.nextRunAt ? String(next.nextRunAt) : null,
        next.lastError ? String(next.lastError) : null,
        next.updatedAt,
        scheduleId
      );
    return next;
  }

  upsertTaskRecord(task) {
    if (!task || !task.id) return;
    // Write to execution_state for v2.1.0+ (backward compat: also writes to task_records)
    this.upsertExecutionState({ ...task, type: 'task' });
    const now = new Date().toISOString();
    const stepResults = Array.isArray(task.stepResults) ? task.stepResults : [];
    const verification = Array.isArray(task.verification) ? task.verification : [];
    const monitoring = Array.isArray(task.monitoring) ? task.monitoring : [];
    this.db
      .prepare(
        `INSERT INTO task_records (
          id, goal, status, session_id, continue_on_failure, step_count, step_done_count, step_failed_count,
          verify_count, verify_failed_count, monitor_count, error, created_at, started_at, finished_at, updated_at, task_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          goal = excluded.goal,
          status = excluded.status,
          session_id = excluded.session_id,
          continue_on_failure = excluded.continue_on_failure,
          step_count = excluded.step_count,
          step_done_count = excluded.step_done_count,
          step_failed_count = excluded.step_failed_count,
          verify_count = excluded.verify_count,
          verify_failed_count = excluded.verify_failed_count,
          monitor_count = excluded.monitor_count,
          error = excluded.error,
          created_at = excluded.created_at,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          updated_at = excluded.updated_at,
          task_json = excluded.task_json`
      )
      .run(
        String(task.id),
        String(task.goal || ''),
        String(task.status || 'unknown'),
        String(task.sessionId || ''),
        task.continueOnFailure === true ? 1 : 0,
        Number(task.steps?.length || 0),
        stepResults.filter((item) => item?.result?.ok).length,
        stepResults.filter((item) => item?.result?.ok === false).length,
        verification.length,
        verification.filter((item) => item?.ok === false).length,
        monitoring.length,
        Array.isArray(task.errors) && task.errors.length ? String(task.errors.at(-1)) : null,
        String(task.createdAt || now),
        String(task.startedAt || now),
        task.finishedAt ? String(task.finishedAt) : null,
        now,
        JSON.stringify(task || {})
      );
  }

  replaceTaskStepResults(taskId, stepResults = []) {
    const trimmed = String(taskId || '').trim();
    if (!trimmed) return;
    this.db.prepare('DELETE FROM task_step_results WHERE task_id = ?').run(trimmed);
    const stmt = this.db.prepare(
      `INSERT INTO task_step_results (
        task_id, step_index, kind, label, tool, ok, error, status, code, path, result_json, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const step of stepResults) {
      const result = step?.result || {};
      stmt.run(
        trimmed,
        Number(step?.index || 0),
        String(step?.kind || ''),
        step?.label ? String(step.label) : null,
        step?.tool ? String(step.tool) : null,
        result.ok ? 1 : 0,
        result.error ? String(result.error) : null,
        Number.isFinite(result.status) ? Number(result.status) : null,
        Number.isFinite(result.code) ? Number(result.code) : null,
        result.path ? String(result.path) : null,
        JSON.stringify(result),
        JSON.stringify(step?.raw || {}),
        new Date().toISOString()
      );
    }
  }

  replaceTaskCheckResults(taskId, phase, checks = []) {
    const trimmed = String(taskId || '').trim();
    const normalizedPhase = String(phase || '').trim().toLowerCase();
    if (!trimmed || !normalizedPhase) return;
    this.db.prepare('DELETE FROM task_check_results WHERE task_id = ? AND phase = ?').run(trimmed, normalizedPhase);
    const stmt = this.db.prepare(
      `INSERT INTO task_check_results (
        task_id, phase, check_index, kind, label, target, ok, error, result_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (let i = 0; i < checks.length; i += 1) {
      const check = checks[i] || {};
      stmt.run(
        trimmed,
        normalizedPhase,
        i,
        String(check.kind || ''),
        check.label ? String(check.label) : null,
        check.target != null ? String(check.target) : null,
        check.ok ? 1 : 0,
        check.error ? String(check.error) : null,
        JSON.stringify(check),
        new Date().toISOString()
      );
    }
  }

  persistTaskState(task) {
    if (!task || !task.id) return;
    this.runInTransaction(() => {
      this.upsertTaskRecord(task);
      this.replaceTaskStepResults(task.id, task.stepResults || []);
      this.replaceTaskCheckResults(task.id, 'verify', task.verification || []);
      this.replaceTaskCheckResults(task.id, 'monitor', task.monitoring || []);
    });
  }

  getTaskRecord(id) {
    const taskId = String(id || '').trim();
    if (!taskId) return null;
    const row = this.db.prepare('SELECT task_json FROM task_records WHERE id = ?').get(taskId);
    if (!row) return null;
    return parseJson(row.task_json, null);
  }

  listTaskRecords(limit = 80) {
    const rows = this.db
      .prepare('SELECT task_json FROM task_records ORDER BY COALESCE(updated_at, started_at) DESC LIMIT ?')
      .all(Math.max(1, Math.min(500, Number(limit || 80))));
    return rows.map((row) => parseJson(row.task_json, null)).filter(Boolean);
  }

  markRunningTasksInterrupted() {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare('SELECT task_json FROM task_records WHERE status = \'running\'')
      .all();
    for (const row of rows) {
      const task = parseJson(row.task_json, null);
      if (!task || !task.id) continue;
      task.status = 'interrupted';
      if (!Array.isArray(task.errors)) task.errors = [];
      if (!task.errors.includes('task_interrupted_by_restart')) task.errors.push('task_interrupted_by_restart');
      task.finishedAt = task.finishedAt || now;
      this.persistTaskState(task);
    }
  }

  upsertWorkerRecord(worker) {
    if (!worker || !worker.id) return;
    const now = new Date().toISOString();
    const sessionId = String(worker.sessionId || `worker:${worker.id}`);
    this.db
      .prepare(
        `INSERT INTO worker_records (
          id, name, goal, status, run_count, fail_count, session_id, last_error, created_at, updated_at, finished_at, worker_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          goal = excluded.goal,
          status = excluded.status,
          run_count = excluded.run_count,
          fail_count = excluded.fail_count,
          session_id = excluded.session_id,
          last_error = excluded.last_error,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          finished_at = excluded.finished_at,
          worker_json = excluded.worker_json`
      )
      .run(
        String(worker.id),
        String(worker.name || ''),
        String(worker.goal || ''),
        String(worker.status || 'unknown'),
        Number(worker.runCount || 0),
        Number(worker.failCount || 0),
        sessionId,
        worker.lastError ? String(worker.lastError) : null,
        String(worker.createdAt || now),
        now,
        worker.lastFinishedAt ? String(worker.lastFinishedAt) : null,
        JSON.stringify(worker || {})
      );
  }

  getWorkerRecord(id) {
    const workerId = String(id || '').trim();
    if (!workerId) return null;
    const row = this.db.prepare('SELECT worker_json FROM worker_records WHERE id = ?').get(workerId);
    if (!row) return null;
    return parseJson(row.worker_json, null);
  }

  listWorkerRecords(limit = 80) {
    const rows = this.db
      .prepare('SELECT worker_json FROM worker_records ORDER BY updated_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(500, Number(limit || 80))));
    return rows.map((row) => parseJson(row.worker_json, null)).filter(Boolean);
  }

  markRunningWorkersInterrupted() {
    const rows = this.db
      .prepare("SELECT worker_json FROM worker_records WHERE status = 'running'")
      .all();
    for (const row of rows) {
      const worker = parseJson(row.worker_json, null);
      if (!worker || !worker.id) continue;
      worker.status = 'failed';
      worker.lastError = worker.lastError || 'worker_interrupted_by_restart';
      worker.nextRunAt = null;
      worker.updatedAt = new Date().toISOString();
      this.upsertWorkerRecord(worker);
    }
  }

  upsertSelfEditRecord(run) {
    if (!run || !run.id) return;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO self_edit_records (
          id, label, goal, status, session_id, last_error, changed_paths, created_at, updated_at, finished_at, run_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          goal = excluded.goal,
          status = excluded.status,
          session_id = excluded.session_id,
          last_error = excluded.last_error,
          changed_paths = excluded.changed_paths,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          finished_at = excluded.finished_at,
          run_json = excluded.run_json`
      )
      .run(
        String(run.id),
        String(run.label || ''),
        String(run.goal || ''),
        String(run.status || 'unknown'),
        String(run.sessionId || ''),
        run.lastError ? String(run.lastError) : null,
        Array.isArray(run.changedPaths) ? run.changedPaths.join(',') : '',
        String(run.createdAt || now),
        now,
        run.finishedAt ? String(run.finishedAt) : null,
        JSON.stringify(run || {})
      );
  }

  getSelfEditRecord(id) {
    const runId = String(id || '').trim();
    if (!runId) return null;
    const row = this.db.prepare('SELECT run_json FROM self_edit_records WHERE id = ?').get(runId);
    if (!row) return null;
    return parseJson(row.run_json, null);
  }

  listSelfEditRecords(limit = 80) {
    const rows = this.db
      .prepare('SELECT run_json FROM self_edit_records ORDER BY updated_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(500, Number(limit || 80))));
    return rows.map((row) => parseJson(row.run_json, null)).filter(Boolean);
  }

  markRunningSelfEditInterrupted() {
    const rows = this.db
      .prepare("SELECT run_json FROM self_edit_records WHERE status = 'running'")
      .all();
    for (const row of rows) {
      const run = parseJson(row.run_json, null);
      if (!run || !run.id) continue;
      run.status = 'failed';
      run.lastError = run.lastError || 'self_edit_interrupted_by_restart';
      run.finishedAt = run.finishedAt || new Date().toISOString();
      this.upsertSelfEditRecord(run);
    }
  }


  upsertExecutionState(state) {
    if (!state || !state.id) return;
    const now = new Date().toISOString();
    const type = String(state.type || 'task').toLowerCase();
    if (!['task', 'mission'].includes(type)) throw new Error(`Invalid execution_state type: ${type}`);
    this.db.prepare(
      `INSERT INTO execution_state (
        id, type, goal, status, session_id, step, max_steps, step_done_count, step_failed_count,
        retries, max_retries, error, continue_on_failure, verify_count, verify_failed_count, monitor_count,
        hard_step_cap, interval_ms, continue_until_done, created_at, started_at, finished_at, updated_at, state_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type=excluded.type, goal=excluded.goal, status=excluded.status, session_id=excluded.session_id,
        step=excluded.step, max_steps=excluded.max_steps, step_done_count=excluded.step_done_count,
        step_failed_count=excluded.step_failed_count, retries=excluded.retries, max_retries=excluded.max_retries,
        error=excluded.error, continue_on_failure=excluded.continue_on_failure, verify_count=excluded.verify_count,
        verify_failed_count=excluded.verify_failed_count, monitor_count=excluded.monitor_count,
        hard_step_cap=excluded.hard_step_cap, interval_ms=excluded.interval_ms,
        continue_until_done=excluded.continue_until_done, finished_at=excluded.finished_at,
        updated_at=excluded.updated_at, state_json=excluded.state_json`
    ).run(
      String(state.id), type, String(state.goal||''), String(state.status||'unknown'), String(state.sessionId||''),
      Number(state.step||0), Number(state.maxSteps||0), Number(state.stepDoneCount||0), Number(state.stepFailedCount||0),
      Number(state.retries||0), Number(state.maxRetries||0), state.error?String(state.error):null,
      type==='task'?(state.continueOnFailure===true?1:0):0, type==='task'?Number(state.verifyCount||0):0,
      type==='task'?Number(state.verifyFailedCount||0):0, type==='task'?Number(state.monitorCount||0):0,
      type==='mission'?Number(state.hardStepCap||0):0, type==='mission'?Number(state.intervalMs||0):0,
      type==='mission'?(state.continueUntilDone===false?0:1):1,
      String(state.createdAt||now), String(state.startedAt||now), state.finishedAt?String(state.finishedAt):null,
      now, JSON.stringify(state||{})
    );
  }

  getExecutionState(id) {
    const row = this.db.prepare('SELECT * FROM execution_state WHERE id = ?').get(String(id||'').trim());
    if (!row) return null;
    return this._parseExecutionStateRow(row);
  }

  listExecutionStates({type, status, sessionId, limit=80}={}) {
    let q='SELECT * FROM execution_state WHERE 1=1', p=[];
    if (type && ['task','mission'].includes(type.toLowerCase())) { q+=' AND type=?'; p.push(type.toLowerCase()); }
    if (status) { q+=' AND status=?'; p.push(String(status)); }
    if (sessionId) { q+=' AND session_id=?'; p.push(String(sessionId)); }
    q+=' ORDER BY updated_at DESC LIMIT ?'; p.push(Math.max(1,Math.min(500,Number(limit||80))));
    return this.db.prepare(q).all(...p).map(r=>this._parseExecutionStateRow(r));
  }

  _parseExecutionStateRow(row) {
    const s={
      id:row.id, type:row.type, goal:row.goal, status:row.status, sessionId:row.session_id,
      step:Number(row.step||0), maxSteps:Number(row.max_steps||0),
      stepDoneCount:Number(row.step_done_count||0), stepFailedCount:Number(row.step_failed_count||0),
      retries:Number(row.retries||0), maxRetries:Number(row.max_retries||0), error:row.error||null,
      createdAt:row.created_at, startedAt:row.started_at, finishedAt:row.finished_at||null, updatedAt:row.updated_at,
      state:parseJson(row.state_json,null)
    };
    if (row.type==='task') { s.continueOnFailure=Boolean(row.continue_on_failure); s.verifyCount=Number(row.verify_count||0); s.verifyFailedCount=Number(row.verify_failed_count||0); s.monitorCount=Number(row.monitor_count||0); }
    else if (row.type==='mission') { s.hardStepCap=Number(row.hard_step_cap||0); s.intervalMs=Number(row.interval_ms||0); s.continueUntilDone=Boolean(row.continue_until_done); }
    return s;
  }

  markExecutionStateFinished(id, status, error=null) {
    const r=this.db.prepare('UPDATE execution_state SET status=?,error=?,finished_at=?,updated_at=? WHERE id=?')
      .run(String(status||'finished'), error?String(error):null, new Date().toISOString(), new Date().toISOString(), String(id||'').trim());
    return r.changes>0?this.getExecutionState(id):null;
  }

  /**
   * Get stale memories sorted by staleness (R5 - Freshness Decay)
   * @param {{threshold?: number, limit?: number, category?: string}} options
   * @returns {Array<{id: number, artifact_type: string, content: string, createdAt: string, freshness: number, category: string}>}
   */
}

export function installExecutionStoreMethods(TargetClass) {
  for (const name of Object.getOwnPropertyNames(ExecutionStoreMethods.prototype)) {
    if (name === 'constructor') continue;
    Object.defineProperty(
      TargetClass.prototype,
      name,
      Object.getOwnPropertyDescriptor(ExecutionStoreMethods.prototype, name)
    );
  }
}
