import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getHomeDir, ensureHome } from '../config.mjs';

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
    `);
  }

  ensureSession(sessionId) {
    this.db
      .prepare('INSERT OR IGNORE INTO sessions (id, created_at) VALUES (?, ?)')
      .run(sessionId, new Date().toISOString());
  }

  addMessage(sessionId, role, content) {
    this.ensureSession(sessionId);
    this.db
      .prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, role, content, new Date().toISOString());
  }

  getMessages(sessionId, limit = 50) {
    return this.db
      .prepare('SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
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
        .prepare('SELECT role, content, created_at FROM messages WHERE session_id = ? AND created_at >= ? ORDER BY id ASC LIMIT ?')
        .all(sessionId, since, limit)
      : this.db
        .prepare('SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?')
        .all(sessionId, limit));
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
}
