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

    return [...facts, ...strategies]
      .map((x) => ({ ...x, score: scoreByOverlap(queryTokens, x.text) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
