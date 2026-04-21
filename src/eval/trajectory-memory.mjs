/**
 * Trajectory Memory Store
 *
 * Persists and retrieves successful/failed agent trajectories for
 * case-based reasoning at inference time.
 *
 * Writes are gated: only trajectories that pass proof scoring and
 * verification checks are stored, and only during consolidation
 * cycles (not at runtime write-through).
 *
 * Reads happen at context-assembly time via TrajectoryRetriever.
 */

import { logInfo, logError } from '../logger.mjs';

const TRAJECTORY_MEMORY_SCHEMA_VERSION = 1;

export function initializeTrajectoryMemorySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trajectory_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_normalized TEXT NOT NULL,
      goal_embedding BLOB,
      task_type TEXT NOT NULL DEFAULT 'general',
      tool_set_signature TEXT NOT NULL DEFAULT '',
      environment_fingerprint TEXT NOT NULL DEFAULT '',
      plan_template TEXT NOT NULL DEFAULT '',
      tool_sequence TEXT NOT NULL DEFAULT '',
      tool_args_schema TEXT NOT NULL DEFAULT '',
      success_score REAL NOT NULL DEFAULT 0,
      proof_passed INTEGER NOT NULL DEFAULT 0,
      verifier_passed INTEGER NOT NULL DEFAULT 0,
      failure_warnings TEXT NOT NULL DEFAULT '',
      schema_version TEXT NOT NULL DEFAULT '',
      runtime_version TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      autonomy_mode TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL DEFAULT '',
      step_count INTEGER NOT NULL DEFAULT 0,
      tool_count INTEGER NOT NULL DEFAULT 0,
      final_text TEXT NOT NULL DEFAULT '',
      consolidated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(goal_normalized, tool_set_signature, task_type, model)
    );
    CREATE INDEX IF NOT EXISTS idx_traj_mem_task_type ON trajectory_memory(task_type);
    CREATE INDEX IF NOT EXISTS idx_traj_mem_success ON trajectory_memory(success_score DESC);
    CREATE INDEX IF NOT EXISTS idx_traj_mem_created ON trajectory_memory(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_traj_mem_model ON trajectory_memory(model);
  `);

  const currentVersion = db.prepare('PRAGMA user_version').get();
  if (currentVersion?.user_version < TRAJECTORY_MEMORY_SCHEMA_VERSION + 50) {
    db.exec(`PRAGMA user_version = ${TRAJECTORY_MEMORY_SCHEMA_VERSION + 50}`);
  }
}

export class TrajectoryMemoryStore {
  constructor({ store: memoryStore } = {}) {
    this._memoryStore = memoryStore;
  }

  _db() {
    if (!this._memoryStore?.db) throw new Error('trajectory_memory: no database available');
    return this._memoryStore.db;
  }

  /**
   * Store a trajectory memory entry.
   * Called during consolidation cycles, not at runtime write-through.
   */
  store(entry) {
    const db = this._db();
    const {
      goal_normalized = '',
      goal_embedding = null,
      task_type = 'general',
      tool_set_signature = '',
      environment_fingerprint = '',
      plan_template = '',
      tool_sequence = '',
      tool_args_schema = '',
      success_score = 0,
      proof_passed = false,
      verifier_passed = false,
      failure_warnings = '',
      schema_version = '',
      runtime_version = '',
      model = '',
      autonomy_mode = '',
      session_id = '',
      step_count = 0,
      tool_count = 0,
      final_text = ''
    } = entry;

    if (!goal_normalized.trim()) return null;

    const existing = db.prepare(
      'SELECT id, success_score FROM trajectory_memory WHERE goal_normalized = ? AND tool_set_signature = ? AND task_type = ? AND model = ?'
    ).get(goal_normalized, tool_set_signature, task_type, model);

    if (existing) {
      if (success_score > (existing.success_score || 0)) {
        db.prepare(`
          UPDATE trajectory_memory SET
            success_score = ?, proof_passed = ?, verifier_passed = ?,
            plan_template = ?, tool_sequence = ?, tool_args_schema = ?,
            failure_warnings = ?, step_count = ?, tool_count = ?,
            final_text = ?, consolidated_at = datetime('now'),
            schema_version = ?, runtime_version = ?, model = ?,
            environment_fingerprint = ?, goal_embedding = ?
          WHERE id = ?
        `).run(
          success_score, proof_passed ? 1 : 0, verifier_passed ? 1 : 0,
          plan_template, tool_sequence, tool_args_schema,
          failure_warnings, step_count, tool_count,
          final_text, schema_version, runtime_version, model,
          environment_fingerprint, goal_embedding,
          existing.id
        );
        logInfo('trajectory_memory_updated', { id: existing.id, goal: goal_normalized.slice(0, 80), score: success_score });
        return { id: existing.id, updated: true };
      }
      return { id: existing.id, updated: false };
    }

    const result = db.prepare(`
      INSERT INTO trajectory_memory (
        goal_normalized, goal_embedding, task_type, tool_set_signature,
        environment_fingerprint, plan_template, tool_sequence, tool_args_schema,
        success_score, proof_passed, verifier_passed, failure_warnings,
        schema_version, runtime_version, model, autonomy_mode, session_id,
        step_count, tool_count, final_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      goal_normalized, goal_embedding, task_type, tool_set_signature,
      environment_fingerprint, plan_template, tool_sequence, tool_args_schema,
      success_score, proof_passed ? 1 : 0, verifier_passed ? 1 : 0, failure_warnings,
      schema_version, runtime_version, model, autonomy_mode, session_id,
      step_count, tool_count, final_text
    );

    logInfo('trajectory_memory_stored', { id: result.lastInsertRowid, goal: goal_normalized.slice(0, 80), task_type, score: success_score });
    return { id: result.lastInsertRowid, updated: false };
  }

  /**
   * Retrieve similar trajectories by goal text matching.
   * Compatibility filtering is done by TrajectoryRetriever, not here.
   */
  retrieveByGoal({ query, limit = 5, minScore = 0.4, taskType = null }) {
    const db = this._db();
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (!terms.length) return [];

    const likeClauses = terms.slice(0, 8).map(() => `goal_normalized LIKE ?`);
    const likeParams = terms.slice(0, 8).map(t => `%${t}%`);

    let sql;
    let params;

    if (taskType) {
      sql = `SELECT * FROM trajectory_memory WHERE success_score >= ? AND task_type = ? AND (${likeClauses.join(' OR ')}) ORDER BY success_score DESC, created_at DESC LIMIT ?`;
      params = [minScore, taskType, ...likeParams, limit];
    } else {
      sql = `SELECT * FROM trajectory_memory WHERE success_score >= ? AND (${likeClauses.join(' OR ')}) ORDER BY success_score DESC, created_at DESC LIMIT ?`;
      params = [minScore, ...likeParams, limit];
    }

    return db.prepare(sql).all(...params);
  }

  /**
   * Retrieve failure trajectories (success_score below threshold).
   */
  retrieveFailures({ query, limit = 3, maxScore = 0.3 }) {
    const db = this._db();
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (!terms.length) return [];

    const likeClauses = terms.slice(0, 6).map(() => `goal_normalized LIKE ?`);
    const likeParams = terms.slice(0, 6).map(t => `%${t}%`);
    const sql = `SELECT * FROM trajectory_memory WHERE success_score <= ? AND (${likeClauses.join(' OR ')}) ORDER BY success_score ASC, created_at DESC LIMIT ?`;
    const params = [maxScore, ...likeParams, limit];

    return db.prepare(sql).all(...params);
  }

  /**
   * Get stats about trajectory memory.
   */
  stats() {
    const db = this._db();
    const total = db.prepare('SELECT COUNT(*) as count FROM trajectory_memory').get()?.count || 0;
    const byType = db.prepare('SELECT task_type, COUNT(*) as count FROM trajectory_memory GROUP BY task_type').all();
    const avgScore = db.prepare('SELECT AVG(success_score) as avg FROM trajectory_memory').get()?.avg || 0;
    return { total, byType, avgScore: Math.round(avgScore * 100) / 100 };
  }
}
