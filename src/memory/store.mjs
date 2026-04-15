import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getHomeDir, ensureHome } from '../config.mjs';
import { calculateFreshness, isStale, getHalfLifeForCategory, applyFreshnessDecay, getFreshnessMetadata } from './freshness-decay.mjs';
import { parseJson, scoreByOverlap, tokenize } from './store-helpers.mjs';
import { installExecutionStoreMethods } from './store-execution-methods.mjs';
import { installSessionStoreMethods } from './store-session-methods.mjs';
import { initializeMemoryStoreSchema } from './store-schema.mjs';
export class MemoryStore {
  constructor() {
    ensureHome();
    this.dbPath = path.join(getHomeDir(), 'openunum.db');
    this.db = new DatabaseSync(this.dbPath);
    this.init();
  }

  init() {
    try {
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch {}
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch {}
    try {
      this.db.exec('PRAGMA synchronous = NORMAL;');
    } catch {}
    initializeMemoryStoreSchema(this.db);
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

    // Apply freshness decay to scores (R5)
    return [...facts, ...strategies, ...routes]
      .map((x) => {
        const baseScore = scoreByOverlap(queryTokens, x.text);
        const createdAtMs = new Date(x.createdAt).getTime();
        const freshnessWeightedScore = applyFreshnessDecay(baseScore, createdAtMs, x.type);
        const freshness = calculateFreshness(createdAtMs, getHalfLifeForCategory(x.type));
        return { 
          ...x, 
          score: freshnessWeightedScore,
          baseScore,
          freshness 
        };
      })
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

  /**
   * Channel State Persistence (for Telegram offset, etc.)
   */
  getChannelState(channelName, stateKey, defaultValue = null) {
    const row = this.db
      .prepare('SELECT state_value FROM channel_state WHERE channel_name = ? AND state_key = ?')
      .get(channelName, stateKey);
    if (!row) return defaultValue;
    try {
      return JSON.parse(row.state_value);
    } catch {
      return row.state_value;
    }
  }

  setChannelState(channelName, stateKey, stateValue) {
    const valueJson = typeof stateValue === 'string' ? stateValue : JSON.stringify(stateValue);
    this.db
      .prepare(
        `INSERT INTO channel_state (channel_name, state_key, state_value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(channel_name, state_key) DO UPDATE SET
           state_value = excluded.state_value,
           updated_at = excluded.updated_at`
      )
      .run(channelName, stateKey, valueJson, new Date().toISOString());
  }

  /**
   * Execution State - Unified state storage for tasks and missions (v2.1.0+)
   * Replaces separate task_records and mission_records tables.
   */
  getStaleMemories({ threshold = 0.125, limit = 50, category = null } = {}) {
    const catFilter = category ? ' AND artifact_type = ?' : '';
    const params = category ? [category, limit] : [limit];
    
    const rows = this.db
      .prepare(
        `SELECT id, artifact_type, content, source_ref, created_at 
         FROM memory_artifacts 
         WHERE 1=1 ${catFilter}
         ORDER BY created_at ASC 
         LIMIT ?`
      )
      .all(...params);
    
    const stale = [];
    for (const row of rows) {
      const createdAtMs = new Date(row.created_at).getTime();
      const halfLifeMs = getHalfLifeForCategory(row.artifact_type);
      const freshness = calculateFreshness(createdAtMs, halfLifeMs);
      
      if (freshness < threshold) {
        stale.push({
          id: row.id,
          type: row.artifact_type,
          content: row.content,
          sourceRef: row.source_ref,
          createdAt: row.created_at,
          freshness,
          halfLifeHours: Math.round(halfLifeMs / (60 * 60 * 1000)),
          category: row.artifact_type
        });
      }
    }
    
    // Sort by freshness (stalest first)
    stale.sort((a, b) => a.freshness - b.freshness);
    return stale.slice(0, limit);
  }

  /**
   * Refresh a memory by updating its timestamp (R5 - Freshness Decay)
   * @param {number} id - Memory artifact ID
   * @returns {{ok: boolean, id: number, refreshedAt: string} | null}
   */
  refreshMemory(id) {
    const trimmed = Number(id || 0);
    if (!trimmed) return null;
    
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE memory_artifacts SET created_at = ? WHERE id = ?')
      .run(now, trimmed);
    
    if (result.changes > 0) {
      return {
        ok: true,
        id: trimmed,
        refreshedAt: now
      };
    }
    return null;
  }

  /**
   * Get route lessons for hippocampal replay (R2 - Memory Consolidation)
   * @param {{since?: string, tool?: string, limit?: number}} options
   * @returns {Array<{id: number, sessionId: string, goalHint: string, routeSignature: string, surface: string, outcome: string, errorExcerpt: string, note: string, createdAt: string}>}
   */
  getRouteLessons({ since = null, tool = null, limit = 200 } = {}) {
    let query = 'SELECT * FROM route_lessons WHERE 1=1';
    const params = [];
    
    if (since) {
      query += ' AND created_at >= ?';
      params.push(String(since));
    }
    
    if (tool) {
      query += ' AND surface = ?';
      params.push(String(tool));
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Math.max(1, Math.min(1000, Number(limit || 200))));
    
    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      goalHint: r.goal_hint,
      routeSignature: r.route_signature,
      surface: r.surface,
      outcome: r.outcome,
      errorExcerpt: r.error_excerpt,
      note: r.note,
      createdAt: r.created_at
    }));
  }

  /**
   * Store a consolidated pattern as memory (R2 - Memory Consolidation)
   * @param {{pattern: string, successes: number, failures: number, examples: Array, weight: number}} pattern
   * @returns {{id: number, ok: boolean}}
   */
  storeConsolidatedPattern(pattern) {
    if (!pattern || !pattern.pattern) return { ok: false, reason: 'pattern_required' };
    
    const now = new Date().toISOString();
    const content = JSON.stringify({
      type: 'consolidated',
      pattern: pattern.pattern,
      successes: pattern.successes || 0,
      failures: pattern.failures || 0,
      examples: pattern.examples || [],
      consolidatedAt: now,
      weight: pattern.weight || 1.5 // Boosted weight for consolidated patterns
    });
    
    const result = this.db
      .prepare(
        'INSERT INTO memory_artifacts (session_id, artifact_type, content, source_ref, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        'consolidator',
        'consolidated',
        content,
        `pattern:${pattern.pattern}`,
        now
      );
    
    return {
      ok: true,
      id: result.lastInsertRowid
    };
  }

  /**
   * Get active consolidated patterns (R2 - Memory Consolidation)
   * @param {{limit?: number}} options
   * @returns {Array<{id: number, pattern: string, successes: number, failures: number, weight: number, createdAt: string}>}
   */
  getConsolidatedPatterns({ limit = 50 } = {}) {
    const rows = this.db
      .prepare(
        'SELECT id, content, created_at FROM memory_artifacts WHERE artifact_type = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all('consolidated', Math.max(1, Math.min(200, Number(limit || 50))));
    
    return rows.map(r => {
      try {
        const data = JSON.parse(r.content);
        return {
          id: r.id,
          pattern: data.pattern,
          successes: data.successes || 0,
          failures: data.failures || 0,
          weight: data.weight || 1.0,
          examples: data.examples || [],
          createdAt: r.created_at
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Get all searchable records from facts, strategy_outcomes, and memory_artifacts (R5)
   * for the HybridRetriever pipeline.
   * @param {number} limit - Max records to return
   * @returns {Array<{id: string, text: string, type: string, createdAt: string}>}
   */
  getAllSearchableRecords(limit = 1000) {
    const rowLimit = Math.max(1, Math.min(2000, Number(limit || 1000)));
    
    const facts = this.db
      .prepare('SELECT id, key, value, created_at FROM facts ORDER BY id DESC LIMIT ?')
      .all(rowLimit)
      .map(r => ({
        id: `fact-${r.id}`,
        text: `${r.key}: ${r.value}`,
        type: 'fact',
        createdAt: r.created_at
      }));

    const strategies = this.db
      .prepare('SELECT id, goal, strategy, success, evidence, created_at FROM strategy_outcomes ORDER BY id DESC LIMIT ?')
      .all(rowLimit)
      .map(r => ({
        id: `strategy-${r.id}`,
        text: `${r.goal} | ${r.strategy} | ${r.success ? 'SUCCESS' : 'FAIL'} | ${r.evidence}`,
        type: 'strategy',
        createdAt: r.created_at
      }));

    const artifacts = this.db
      .prepare('SELECT id, artifact_type, content, created_at FROM memory_artifacts ORDER BY id DESC LIMIT ?')
      .all(rowLimit)
      .map(r => ({
        id: `artifact-${r.id}`,
        text: String(r.content || ''),
        type: r.artifact_type,
        createdAt: r.created_at
      }));

    return [...facts, ...strategies, ...artifacts]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, rowLimit);
  }
}

installExecutionStoreMethods(MemoryStore);
installSessionStoreMethods(MemoryStore);
