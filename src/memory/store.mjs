import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getHomeDir, ensureHome } from '../config.mjs';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function scoreByOverlap(queryTokens, text) {
  const tokens = new Set(tokenize(text));
  if (!queryTokens.length || !tokens.size) return 0;
  let hits = 0;
  for (const t of queryTokens) if (tokens.has(t)) hits += 1;
  return hits / Math.sqrt(tokens.size);
}

function summarizeSessionTitle(text) {
  const raw = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/[*_>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return 'New Chat';
  const words = raw.split(' ').filter(Boolean);
  const short = words.slice(0, 9).join(' ');
  return short.length > 72 ? `${short.slice(0, 69)}...` : short;
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text || 'null');
  } catch {
    return fallback;
  }
}

export class MemoryStore {
  constructor() {
    ensureHome();
    this.dbPath = path.join(getHomeDir(), 'openunum.db');
    this.db = new DatabaseSync(this.dbPath);
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tool_runs (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        args_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        ok INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS strategy_outcomes (
        id INTEGER PRIMARY KEY,
        goal TEXT NOT NULL,
        strategy TEXT NOT NULL,
        success INTEGER NOT NULL,
        evidence TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_compactions (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        cutoff_message_id INTEGER NOT NULL,
        model TEXT NOT NULL,
        ctx_limit INTEGER NOT NULL,
        pre_tokens INTEGER NOT NULL,
        post_tokens INTEGER NOT NULL,
        summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_artifacts (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        content TEXT NOT NULL,
        source_ref TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS controller_behaviors (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        class_id TEXT NOT NULL,
        sample_count INTEGER NOT NULL,
        reasons_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, model)
      );
      CREATE TABLE IF NOT EXISTS route_lessons (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        goal_hint TEXT NOT NULL,
        route_signature TEXT NOT NULL,
        surface TEXT NOT NULL,
        outcome TEXT NOT NULL,
        error_excerpt TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operation_receipts (
        operation_id TEXT PRIMARY KEY,
        operation_kind TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mission_records (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        session_id TEXT NOT NULL,
        step INTEGER NOT NULL,
        max_steps INTEGER NOT NULL,
        hard_step_cap INTEGER NOT NULL,
        retries INTEGER NOT NULL,
        max_retries INTEGER NOT NULL,
        interval_ms INTEGER NOT NULL,
        continue_until_done INTEGER NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        updated_at TEXT NOT NULL,
        mission_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mission_schedules (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        run_at TEXT NOT NULL,
        interval_ms INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        status TEXT NOT NULL,
        options_json TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_records (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        session_id TEXT NOT NULL,
        continue_on_failure INTEGER NOT NULL,
        step_count INTEGER NOT NULL,
        step_done_count INTEGER NOT NULL,
        step_failed_count INTEGER NOT NULL,
        verify_count INTEGER NOT NULL,
        verify_failed_count INTEGER NOT NULL,
        monitor_count INTEGER NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        updated_at TEXT NOT NULL,
        task_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_records_status_updated ON task_records(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_records_session_updated ON task_records(session_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_records_created ON task_records(created_at DESC);
      CREATE TABLE IF NOT EXISTS task_step_results (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        label TEXT,
        tool TEXT,
        ok INTEGER NOT NULL,
        error TEXT,
        status INTEGER,
        code INTEGER,
        path TEXT,
        result_json TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_step_results_task_step ON task_step_results(task_id, step_index);
      CREATE INDEX IF NOT EXISTS idx_task_step_results_task_created ON task_step_results(task_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS task_check_results (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        check_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        label TEXT,
        target TEXT,
        ok INTEGER NOT NULL,
        error TEXT,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_check_results_task_phase ON task_check_results(task_id, phase, check_index);
    `);
  }

  ensureSession(sessionId) {
    this.db
      .prepare('INSERT OR IGNORE INTO sessions (id, created_at) VALUES (?, ?)')
      .run(sessionId, new Date().toISOString());
  }

  createSession(sessionId) {
    this.ensureSession(sessionId);
    return this.getSessionSummary(sessionId);
  }

  addMessage(sessionId, role, content) {
    this.ensureSession(sessionId);
    this.db
      .prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, role, content, new Date().toISOString());
  }

  importSession({ sessionId, messages = [] }) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    this.ensureSession(sid);
    for (const message of messages) {
      const role = ['system', 'user', 'assistant', 'tool'].includes(String(message?.role || ''))
        ? String(message.role)
        : 'assistant';
      const content = String(message?.content || '');
      const createdAt = String(message?.created_at || message?.createdAt || new Date().toISOString());
      this.db
        .prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
        .run(sid, role, content, createdAt);
    }
    return this.getSessionSummary(sid);
  }

  cloneSession({ sourceSessionId, targetSessionId }) {
    const sourceId = String(sourceSessionId || '').trim();
    const targetId = String(targetSessionId || '').trim();
    if (!sourceId) throw new Error('sourceSessionId is required');
    if (!targetId) throw new Error('targetSessionId is required');
    const sourceMessages = this.getAllMessagesForSession(sourceId);
    if (!sourceMessages.length) throw new Error('source_session_not_found_or_empty');
    return this.importSession({
      sessionId: targetId,
      messages: sourceMessages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.created_at
      }))
    });
  }

  runInTransaction(fn) {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }

  getOperationReceipt(operationId) {
    const opId = String(operationId || '').trim();
    if (!opId) return null;
    const row = this.db
      .prepare('SELECT operation_id, operation_kind, target_ref, result_json, created_at FROM operation_receipts WHERE operation_id = ?')
      .get(opId);
    if (!row) return null;
    return {
      operationId: row.operation_id,
      operationKind: row.operation_kind,
      targetRef: row.target_ref,
      result: JSON.parse(row.result_json || '{}'),
      createdAt: row.created_at
    };
  }

  recordOperationReceipt({ operationId, operationKind, targetRef, result }) {
    const opId = String(operationId || '').trim();
    if (!opId) return;
    this.db
      .prepare(
        'INSERT OR REPLACE INTO operation_receipts (operation_id, operation_kind, target_ref, result_json, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        opId,
        String(operationKind || 'unknown'),
        String(targetRef || ''),
        JSON.stringify(result || {}),
        new Date().toISOString()
      );
  }

  listOperationReceipts(limit = 50) {
    const rows = this.db
      .prepare(
        'SELECT operation_id, operation_kind, target_ref, created_at FROM operation_receipts ORDER BY created_at DESC LIMIT ?'
      )
      .all(Math.max(1, Math.min(500, Number(limit || 50))));
    return rows.map((row) => ({
      operationId: row.operation_id,
      operationKind: row.operation_kind,
      targetRef: row.target_ref,
      createdAt: row.created_at
    }));
  }

  upsertMissionRecord(mission) {
    if (!mission || !mission.id) return;
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

  deleteSession(sessionId, options = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    const operationId = String(options?.operationId || '').trim();
    if (operationId) {
      const prior = this.getOperationReceipt(operationId);
      if (prior) {
        return {
          ok: true,
          replayed: true,
          operationId,
          ...prior.result
        };
      }
    }
    const counts = this.runInTransaction(() => {
      const deletedMessages = this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sid);
      const deletedToolRuns = this.db.prepare('DELETE FROM tool_runs WHERE session_id = ?').run(sid);
      const deletedCompactions = this.db.prepare('DELETE FROM session_compactions WHERE session_id = ?').run(sid);
      const deletedArtifacts = this.db.prepare('DELETE FROM memory_artifacts WHERE session_id = ?').run(sid);
      const deletedRoutes = this.db.prepare('DELETE FROM route_lessons WHERE session_id = ?').run(sid);
      const deletedSessions = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      return {
        deletedMessages: Number(deletedMessages?.changes || 0),
        deletedToolRuns: Number(deletedToolRuns?.changes || 0),
        deletedCompactions: Number(deletedCompactions?.changes || 0),
        deletedArtifacts: Number(deletedArtifacts?.changes || 0),
        deletedRoutes: Number(deletedRoutes?.changes || 0),
        deletedSessions: Number(deletedSessions?.changes || 0)
      };
    });
    const out = {
      ok: true,
      sessionId: sid,
      deleted: counts.deletedSessions > 0,
      ...counts
    };
    if (operationId) {
      this.recordOperationReceipt({
        operationId,
        operationKind: 'session_delete',
        targetRef: sid,
        result: out
      });
      out.operationId = operationId;
    }
    return out;
  }

  clearSessions({ keepSessionId = '', operationId = '' } = {}) {
    const keep = String(keepSessionId || '').trim();
    const opId = String(operationId || '').trim();
    if (opId) {
      const prior = this.getOperationReceipt(opId);
      if (prior) {
        return {
          ok: true,
          replayed: true,
          operationId: opId,
          ...prior.result
        };
      }
    }
    if (keep) this.ensureSession(keep);
    const counts = this.runInTransaction(() => {
      const deletedMessages = keep
        ? this.db.prepare('DELETE FROM messages WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM messages').run();
      const deletedToolRuns = keep
        ? this.db.prepare('DELETE FROM tool_runs WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM tool_runs').run();
      const deletedCompactions = keep
        ? this.db.prepare('DELETE FROM session_compactions WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM session_compactions').run();
      const deletedArtifacts = keep
        ? this.db.prepare('DELETE FROM memory_artifacts WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM memory_artifacts').run();
      const deletedRoutes = keep
        ? this.db.prepare('DELETE FROM route_lessons WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM route_lessons').run();
      const deletedSessions = keep
        ? this.db.prepare('DELETE FROM sessions WHERE id != ?').run(keep)
        : this.db.prepare('DELETE FROM sessions').run();
      return {
        deletedMessages: Number(deletedMessages?.changes || 0),
        deletedToolRuns: Number(deletedToolRuns?.changes || 0),
        deletedCompactions: Number(deletedCompactions?.changes || 0),
        deletedArtifacts: Number(deletedArtifacts?.changes || 0),
        deletedRoutes: Number(deletedRoutes?.changes || 0),
        deletedSessions: Number(deletedSessions?.changes || 0)
      };
    });
    const out = {
      ok: true,
      keepSessionId: keep || null,
      ...counts
    };
    if (opId) {
      this.recordOperationReceipt({
        operationId: opId,
        operationKind: 'session_clear',
        targetRef: keep || '*',
        result: out
      });
      out.operationId = opId;
    }
    return out;
  }

  getSessionSummary(sessionId) {
    const row = this.db
      .prepare(
        `SELECT
          s.id,
          s.created_at,
          (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id ASC LIMIT 1) AS first_user,
          (SELECT content FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_content,
          (SELECT role FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_role,
          (SELECT created_at FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_message_at,
          (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s
         WHERE s.id = ?`
      )
      .get(sessionId);
    if (!row) return null;
    return {
      sessionId: row.id,
      title: summarizeSessionTitle(row.first_user || row.last_content || ''),
      preview: String(row.last_content || '').slice(0, 180),
      lastRole: row.last_role || null,
      messageCount: Number(row.message_count || 0),
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at || row.created_at
    };
  }

  listSessions(limit = 80) {
    const rows = this.db
      .prepare(
        `SELECT
          s.id,
          s.created_at,
          (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id ASC LIMIT 1) AS first_user,
          (SELECT content FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_content,
          (SELECT role FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_role,
          (SELECT created_at FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_message_at,
          (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s
         ORDER BY COALESCE(
           (SELECT created_at FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1),
           s.created_at
         ) DESC
         LIMIT ?`
      )
      .all(limit);
    return rows.map((row) => ({
      sessionId: row.id,
      title: summarizeSessionTitle(row.first_user || row.last_content || ''),
      preview: String(row.last_content || '').slice(0, 180),
      lastRole: row.last_role || null,
      messageCount: Number(row.message_count || 0),
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at || row.created_at
    }));
  }

  getMessages(sessionId, limit = 50) {
    return this.db
      .prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit)
      .reverse();
  }

  rememberFact(key, value) {
    this.db
      .prepare('INSERT INTO facts (key, value, created_at) VALUES (?, ?, ?)')
      .run(key, value, new Date().toISOString());
  }

  retrieveFacts(query, limit = 5) {
    return this.db
      .prepare('SELECT key, value, created_at FROM facts WHERE key LIKE ? OR value LIKE ? ORDER BY id DESC LIMIT ?')
      .all(`%${query}%`, `%${query}%`, limit);
  }

  listFacts({ prefix = '', limit = 200 } = {}) {
    const normalizedPrefix = String(prefix || '').trim();
    const rowLimit = Math.max(1, Math.min(1000, Number(limit || 200)));
    const rows = normalizedPrefix
      ? this.db
        .prepare('SELECT key, value, created_at FROM facts WHERE key LIKE ? ORDER BY id DESC LIMIT ?')
        .all(`${normalizedPrefix}%`, rowLimit)
      : this.db
        .prepare('SELECT key, value, created_at FROM facts ORDER BY id DESC LIMIT ?')
        .all(rowLimit);
    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      createdAt: row.created_at
    }));
  }

  recordToolRun({ sessionId, toolName, args, result }) {
    this.ensureSession(sessionId);
    const ok = result?.ok ? 1 : 0;
    this.db
      .prepare('INSERT INTO tool_runs (session_id, tool_name, args_json, result_json, ok, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        sessionId,
        toolName,
        JSON.stringify(args || {}),
        JSON.stringify(result || {}),
        ok,
        new Date().toISOString()
      );
  }

  getRecentToolRuns(sessionId, limit = 30) {
    const rows = this.db
      .prepare('SELECT tool_name, args_json, result_json, ok, created_at FROM tool_runs WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit)
      .reverse();
    return this.mapToolRows(rows);
  }

  getToolRunsSince(sessionId, sinceIso, limit = 80) {
    const since = String(sinceIso || '').trim();
    const rows = since
      ? this.db
        .prepare(
          'SELECT tool_name, args_json, result_json, ok, created_at FROM tool_runs WHERE session_id = ? AND created_at >= ? ORDER BY id ASC LIMIT ?'
        )
        .all(sessionId, since, limit)
      : this.db
        .prepare('SELECT tool_name, args_json, result_json, ok, created_at FROM tool_runs WHERE session_id = ? ORDER BY id ASC LIMIT ?')
        .all(sessionId, limit);
    return this.mapToolRows(rows);
  }

  getMessagesSince(sessionId, sinceIso, limit = 80) {
    const since = String(sinceIso || '').trim();
    return (since
      ? this.db
        .prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? AND created_at >= ? ORDER BY id ASC LIMIT ?')
        .all(sessionId, since, limit)
      : this.db
        .prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?')
        .all(sessionId, limit));
  }

  getAllMessagesForSession(sessionId) {
    return this.db
      .prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId);
  }

  getLatestSessionCompaction(sessionId) {
    const row = this.db
      .prepare(
        'SELECT id, session_id, cutoff_message_id, model, ctx_limit, pre_tokens, post_tokens, summary_json, created_at FROM session_compactions WHERE session_id = ? ORDER BY id DESC LIMIT 1'
      )
      .get(sessionId);
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.session_id,
      cutoffMessageId: row.cutoff_message_id,
      model: row.model,
      ctxLimit: Number(row.ctx_limit || 0),
      preTokens: Number(row.pre_tokens || 0),
      postTokens: Number(row.post_tokens || 0),
      summary: JSON.parse(row.summary_json || '{}'),
      createdAt: row.created_at
    };
  }

  getMessagesForContext(sessionId, limit = 600) {
    const latest = this.getLatestSessionCompaction(sessionId);
    if (!latest) {
      return this.db
        .prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?')
        .all(sessionId, limit);
    }
    return this.db
      .prepare(
        'SELECT id, role, content, created_at FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?'
      )
      .all(sessionId, latest.cutoffMessageId, limit);
  }

  recordSessionCompaction({ sessionId, cutoffMessageId, model, ctxLimit, preTokens, postTokens, summary }) {
    this.db
      .prepare(
        'INSERT INTO session_compactions (session_id, cutoff_message_id, model, ctx_limit, pre_tokens, post_tokens, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        sessionId,
        Number(cutoffMessageId || 0),
        String(model || ''),
        Number(ctxLimit || 0),
        Number(preTokens || 0),
        Number(postTokens || 0),
        JSON.stringify(summary || {}),
        new Date().toISOString()
      );
  }

  listSessionCompactions(sessionId, limit = 20) {
    const rows = this.db
      .prepare(
        'SELECT id, cutoff_message_id, model, ctx_limit, pre_tokens, post_tokens, summary_json, created_at FROM session_compactions WHERE session_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(sessionId, limit);
    return rows.map((r) => ({
      id: r.id,
      cutoffMessageId: r.cutoff_message_id,
      model: r.model,
      ctxLimit: Number(r.ctx_limit || 0),
      preTokens: Number(r.pre_tokens || 0),
      postTokens: Number(r.post_tokens || 0),
      summary: JSON.parse(r.summary_json || '{}'),
      createdAt: r.created_at
    }));
  }

  addMemoryArtifact({ sessionId, artifactType, content, sourceRef = '' }) {
    this.db
      .prepare(
        'INSERT INTO memory_artifacts (session_id, artifact_type, content, source_ref, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(sessionId, artifactType, content, sourceRef, new Date().toISOString());
  }

  addMemoryArtifacts(sessionId, artifacts = []) {
    for (const a of artifacts) {
      this.addMemoryArtifact({
        sessionId,
        artifactType: String(a.type || 'note'),
        content: String(a.content || ''),
        sourceRef: String(a.sourceRef || '')
      });
    }
  }

  getMemoryArtifacts(sessionId, limit = 40) {
    return this.db
      .prepare(
        'SELECT id, artifact_type, content, source_ref, created_at FROM memory_artifacts WHERE session_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(sessionId, limit)
      .map((r) => ({
        id: r.id,
        type: r.artifact_type,
        content: r.content,
        sourceRef: r.source_ref,
        createdAt: r.created_at
      }));
  }

  mapToolRows(rows) {
    return rows.map((r) => ({
      toolName: r.tool_name,
      args: JSON.parse(r.args_json || '{}'),
      result: JSON.parse(r.result_json || '{}'),
      ok: Boolean(r.ok),
      createdAt: r.created_at
    }));
  }

  countSuccessfulToolRuns(sessionId) {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM tool_runs WHERE session_id = ? AND ok = 1')
      .get(sessionId);
    return Number(row?.c || 0);
  }

  recordStrategyOutcome({ goal, strategy, success, evidence }) {
    this.db
      .prepare('INSERT INTO strategy_outcomes (goal, strategy, success, evidence, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(goal, strategy, success ? 1 : 0, evidence || '', new Date().toISOString());
  }

  retrieveStrategyHints(goal, limit = 4) {
    const rows = this.db
      .prepare(
        'SELECT strategy, success, evidence, created_at FROM strategy_outcomes WHERE goal LIKE ? ORDER BY id DESC LIMIT ?'
      )
      .all(`%${goal}%`, limit);
    return rows.map((r) => ({
      strategy: r.strategy,
      success: Boolean(r.success),
      evidence: r.evidence,
      createdAt: r.created_at
    }));
  }

  retrieveStrategyHintsSmart(goal, limit = 6) {
    const rows = this.db
      .prepare('SELECT goal, strategy, success, evidence, created_at FROM strategy_outcomes ORDER BY id DESC LIMIT 400')
      .all();
    const queryTokens = tokenize(goal);
    return rows
      .map((r) => {
        const corpus = `${r.goal}\n${r.strategy}\n${r.evidence}`;
        const overlap = scoreByOverlap(queryTokens, corpus);
        const successBoost = r.success ? 0.15 : 0;
        return {
          strategy: r.strategy,
          success: Boolean(r.success),
          evidence: r.evidence,
          createdAt: r.created_at,
          score: overlap + successBoost
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  searchKnowledge(query, limit = 8) {
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return [];

    const facts = this.db
      .prepare('SELECT key, value, created_at FROM facts ORDER BY id DESC LIMIT 300')
      .all()
      .map((r) => ({
        type: 'fact',
        text: `${r.key}: ${r.value}`,
        createdAt: r.created_at
      }));

    const strategies = this.db
      .prepare('SELECT strategy, success, evidence, created_at FROM strategy_outcomes ORDER BY id DESC LIMIT 300')
      .all()
      .map((r) => ({
        type: 'strategy',
        text: `${r.strategy} | ${r.success ? 'SUCCESS' : 'FAIL'} | ${r.evidence}`,
        createdAt: r.created_at
      }));

    const routes = this.db
      .prepare(
        'SELECT route_signature, surface, outcome, error_excerpt, note, created_at FROM route_lessons ORDER BY id DESC LIMIT 300'
      )
      .all()
      .map((r) => ({
        type: 'route',
        text: `${r.route_signature} | ${r.surface} | ${r.outcome} | ${r.error_excerpt} | ${r.note}`,
        createdAt: r.created_at
      }));

    return [...facts, ...strategies, ...routes]
      .map((x) => ({ ...x, score: scoreByOverlap(queryTokens, x.text) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getStrategyLedger({ goal = '', limit = 12 } = {}) {
    const trimmed = String(goal || '').trim();
    const rows = trimmed
      ? this.db
        .prepare(
          'SELECT goal, strategy, success, evidence, created_at FROM strategy_outcomes WHERE goal LIKE ? ORDER BY id DESC LIMIT ?'
        )
        .all(`%${trimmed}%`, limit)
      : this.db
        .prepare('SELECT goal, strategy, success, evidence, created_at FROM strategy_outcomes ORDER BY id DESC LIMIT ?')
        .all(limit);
    return rows.map((r) => ({
      goal: r.goal,
      strategy: r.strategy,
      success: Boolean(r.success),
      evidence: r.evidence,
      createdAt: r.created_at
    }));
  }

  getToolReliability(limit = 12) {
    const rows = this.db
      .prepare(
        `SELECT
          tool_name,
          COUNT(*) AS total,
          SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS success_count,
          SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failure_count,
          MAX(created_at) AS last_used_at
         FROM tool_runs
         GROUP BY tool_name
         ORDER BY total DESC, tool_name ASC
         LIMIT ?`
      )
      .all(limit);
    return rows.map((r) => ({
      toolName: r.tool_name,
      total: Number(r.total || 0),
      successCount: Number(r.success_count || 0),
      failureCount: Number(r.failure_count || 0),
      successRate: Number(r.total || 0) > 0 ? Number(r.success_count || 0) / Number(r.total || 1) : 0,
      lastUsedAt: r.last_used_at || null
    }));
  }

  upsertControllerBehavior({ provider, model, classId, sampleCount = 0, reasons = [] }) {
    const p = String(provider || '').trim().toLowerCase();
    const m = String(model || '').trim().toLowerCase();
    const c = String(classId || '').trim();
    if (!p || !m || !c) return;
    const normalizedReasons = Array.isArray(reasons)
      ? reasons.map((line) => String(line || '').trim()).filter(Boolean).slice(0, 20)
      : [];
    this.db
      .prepare(
        `INSERT INTO controller_behaviors (provider, model, class_id, sample_count, reasons_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, model) DO UPDATE SET
           class_id = excluded.class_id,
           sample_count = excluded.sample_count,
           reasons_json = excluded.reasons_json,
           updated_at = excluded.updated_at`
      )
      .run(
        p,
        m,
        c,
        Math.max(0, Number(sampleCount || 0) || 0),
        JSON.stringify(normalizedReasons),
        new Date().toISOString()
      );
  }

  listControllerBehaviors(limit = 80) {
    const rows = this.db
      .prepare(
        `SELECT provider, model, class_id, sample_count, reasons_json, updated_at
         FROM controller_behaviors
         ORDER BY sample_count DESC, updated_at DESC
         LIMIT ?`
      )
      .all(limit);
    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      classId: r.class_id,
      sampleCount: Number(r.sample_count || 0),
      reasons: JSON.parse(r.reasons_json || '[]'),
      updatedAt: r.updated_at
    }));
  }

  removeControllerBehavior({ provider, model } = {}) {
    const p = String(provider || '').trim().toLowerCase();
    const m = String(model || '').trim().toLowerCase();
    if (!p || !m) return { ok: false, removed: false, reason: 'provider_and_model_required' };
    const out = this.db
      .prepare('DELETE FROM controller_behaviors WHERE provider = ? AND model = ?')
      .run(p, m);
    return {
      ok: true,
      removed: Number(out?.changes || 0) > 0
    };
  }

  clearControllerBehaviors() {
    const out = this.db
      .prepare('DELETE FROM controller_behaviors')
      .run();
    return {
      ok: true,
      removedCount: Number(out?.changes || 0)
    };
  }

  recordRouteLesson({
    sessionId,
    goal = '',
    routeSignature,
    surface = 'tool',
    success = false,
    errorExcerpt = '',
    note = '',
    createdAt = null
  }) {
    const signature = String(routeSignature || '').trim().toLowerCase();
    if (!signature) return;
    this.ensureSession(sessionId);
    this.db
      .prepare(
        `INSERT INTO route_lessons
          (session_id, goal_hint, route_signature, surface, outcome, error_excerpt, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(sessionId || ''),
        String(goal || '').slice(0, 500),
        signature.slice(0, 400),
        String(surface || 'tool').slice(0, 60).toLowerCase(),
        success ? 'success' : 'failure',
        String(errorExcerpt || '').slice(0, 300),
        String(note || '').slice(0, 400),
        String(createdAt || new Date().toISOString())
      );
  }

  getRouteGuidance({ goal = '', limit = 10 } = {}) {
    const trimmed = String(goal || '').trim();
    const rows = trimmed
      ? this.db
        .prepare(
          `SELECT
             route_signature,
             surface,
             COUNT(*) AS total,
             SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success_count,
             SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) AS failure_count,
             MAX(created_at) AS last_seen
           FROM route_lessons
           WHERE goal_hint LIKE ?
           GROUP BY route_signature, surface
           ORDER BY failure_count DESC, success_count DESC, last_seen DESC
           LIMIT ?`
        )
        .all(`%${trimmed}%`, limit)
      : this.db
        .prepare(
          `SELECT
             route_signature,
             surface,
             COUNT(*) AS total,
             SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success_count,
             SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) AS failure_count,
             MAX(created_at) AS last_seen
           FROM route_lessons
           GROUP BY route_signature, surface
           ORDER BY failure_count DESC, success_count DESC, last_seen DESC
           LIMIT ?`
        )
        .all(limit);
    return rows.map((r) => {
      const total = Number(r.total || 0);
      const successCount = Number(r.success_count || 0);
      const failureCount = Number(r.failure_count || 0);
      return {
        routeSignature: r.route_signature,
        surface: r.surface,
        total,
        successCount,
        failureCount,
        successRate: total > 0 ? successCount / total : 0,
        lastSeen: r.last_seen || null
      };
    });
  }
}
