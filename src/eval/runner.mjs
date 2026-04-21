/**
 * Eval Runner
 *
 * Loads eval trajectories from the HF pilot corpus or custom eval sets,
 * runs them through the OpenUnum agent, and captures results for grading.
 *
 * Usage:
 *   node scripts/eval-run.mjs [--corpus hf-pilot] [--limit 10] [--task-types general,tool_call]
 *   node scripts/eval-run.mjs [--corpus custom] [--custom-path data/eval/custom.jsonl]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logInfo, logError } from '../logger.mjs';

const OPENUNUM_HOME = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');

const EVAL_RESULTS_SCHEMA_VERSION = 1;

export function initializeEvalResultsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eval_run_id TEXT NOT NULL,
      trajectory_id TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'general',
      goal TEXT NOT NULL DEFAULT '',
      expected_tool_calls TEXT NOT NULL DEFAULT '',
      expected_final TEXT NOT NULL DEFAULT '',
      actual_tool_calls TEXT NOT NULL DEFAULT '',
      actual_final TEXT NOT NULL DEFAULT '',
      grader_type TEXT NOT NULL DEFAULT 'proof_score',
      grade_result TEXT NOT NULL DEFAULT '',
      grade_score REAL NOT NULL DEFAULT 0,
      grade_details TEXT NOT NULL DEFAULT '',
      proof_score REAL NOT NULL DEFAULT 0,
      verifier_passed INTEGER NOT NULL DEFAULT 0,
      step_count INTEGER NOT NULL DEFAULT 0,
      tool_count INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      autonomy_mode TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL DEFAULT '',
      source_dataset TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_eval_run_id ON eval_results(eval_run_id);
    CREATE INDEX IF NOT EXISTS idx_eval_task_type ON eval_results(task_type);
    CREATE INDEX IF NOT EXISTS idx_eval_grade_score ON eval_results(grade_score DESC);
    CREATE INDEX IF NOT EXISTS idx_eval_created ON eval_results(created_at DESC);
  `);

  const currentVersion = db.prepare('PRAGMA user_version').get();
  if (currentVersion?.user_version < EVAL_RESULTS_SCHEMA_VERSION + 50) {
    db.exec(`PRAGMA user_version = ${EVAL_RESULTS_SCHEMA_VERSION + 50}`);
  }
}

/**
 * Load eval trajectories from a JSONL file.
 */
export function loadEvalCorpus({ corpusPath, limit = 0, taskTypes = [] } = {}) {
  if (!fs.existsSync(corpusPath)) {
    throw new Error(`eval corpus not found: ${corpusPath}`);
  }

  const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean);
  const trajectories = [];

  for (const line of lines) {
    try {
      const traj = JSON.parse(line);
      if (!traj.goal && !traj.plan) continue;

      // Filter by task types if specified
      if (taskTypes.length > 0) {
        const tt = traj.task_type || classifyEvalTrajectory(traj);
        if (!taskTypes.includes(tt)) continue;
      }

      trajectories.push(traj);
    } catch {
      continue;
    }
  }

  if (limit > 0) return trajectories.slice(0, limit);
  return trajectories;
}

/**
 * Enrich a trajectory with expected fields for evaluation.
 */
export function enrichEvalTrajectory(traj) {
  return {
    ...traj,
    task_type: traj.task_type || classifyEvalTrajectory(traj),
    expected_tool_calls: traj.expected_tool_calls || traj.tool_calls || [],
    expected_final: traj.expected_final || traj.final || '',
    grader_type: traj.grader_type || inferGraderType(traj),
    max_steps: traj.max_steps || 10,
    allowed_tools: traj.allowed_tools || [],
    forbidden_tools: traj.forbidden_tools || []
  };
}

/**
 * Infer grader type from trajectory content.
 */
function inferGraderType(traj) {
  if (traj.tool_calls?.length > 0 && traj.final) return 'trace_and_final';
  if (traj.tool_calls?.length > 0) return 'trace';
  if (traj.final) return 'final_answer';
  return 'proof_score';
}

/**
 * Classify an eval trajectory by its content.
 */
function classifyEvalTrajectory(traj) {
  const goal = String(traj.goal || '').toLowerCase();
  const tools = traj.tool_calls || [];

  if (tools.some(t => /browser|navigate|click|snapshot/i.test(t.name || ''))) return 'browser';
  if (tools.some(t => /file|write|edit|read/i.test(t.name || ''))) return 'coding';
  if (tools.some(t => /shell|exec|http_request/i.test(t.name || ''))) return 'multi_turn';
  if (tools.length > 0) return 'tool_call';
  if (goal.includes('plan') || goal.includes('decompose') || goal.includes('step')) return 'planning';
  return 'general';
}

/**
 * Store an eval result in the database.
 */
export function storeEvalResult(db, result) {
  const {
    evalRunId = '',
    trajectoryId = '',
    taskType = 'general',
    goal = '',
    expectedToolCalls = '',
    expectedFinal = '',
    actualToolCalls = '',
    actualFinal = '',
    graderType = 'proof_score',
    gradeResult = '',
    gradeScore = 0,
    gradeDetails = '',
    proofScore = 0,
    verifierPassed = false,
    stepCount = 0,
    toolCount = 0,
    latencyMs = 0,
    model = '',
    autonomyMode = '',
    sessionId = '',
    sourceDataset = ''
  } = result;

  db.prepare(`
    INSERT INTO eval_results (
      eval_run_id, trajectory_id, task_type, goal,
      expected_tool_calls, expected_final, actual_tool_calls, actual_final,
      grader_type, grade_result, grade_score, grade_details,
      proof_score, verifier_passed, step_count, tool_count,
      latency_ms, model, autonomy_mode, session_id, source_dataset
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evalRunId, trajectoryId, taskType, goal,
    expectedToolCalls, expectedFinal, actualToolCalls, actualFinal,
    graderType, gradeResult, gradeScore, gradeDetails,
    proofScore, verifierPassed ? 1 : 0, stepCount, toolCount,
    latencyMs, model, autonomyMode, sessionId, sourceDataset
  );

  logInfo('eval_result_stored', { evalRunId, trajectoryId, gradeScore, graderType });
}

/**
 * Get eval results for a run.
 */
export function getEvalResults(db, { evalRunId, limit = 100 } = {}) {
  if (evalRunId) {
    return db.prepare('SELECT * FROM eval_results WHERE eval_run_id = ? ORDER BY created_at DESC LIMIT ?').all(evalRunId, limit);
  }
  return db.prepare('SELECT * FROM eval_results ORDER BY created_at DESC LIMIT ?').all(limit);
}

/**
 * Get eval stats.
 */
export function getEvalStats(db) {
  const total = db.prepare('SELECT COUNT(*) as count FROM eval_results').get()?.count || 0;
  const avgScore = db.prepare('SELECT AVG(grade_score) as avg FROM eval_results').get()?.avg || 0;
  const byGraderType = db.prepare('SELECT grader_type, COUNT(*) as count, AVG(grade_score) as avg_score FROM eval_results GROUP BY grader_type').all();
  const byTaskType = db.prepare('SELECT task_type, COUNT(*) as count, AVG(grade_score) as avg_score FROM eval_results GROUP BY task_type').all();
  const recentRuns = db.prepare('SELECT eval_run_id, COUNT(*) as count, AVG(grade_score) as avg_score, MAX(created_at) as last_at FROM eval_results GROUP BY eval_run_id ORDER BY last_at DESC LIMIT 10').all();
  return { total, avgScore: Math.round(avgScore * 100) / 100, byGraderType, byTaskType, recentRuns };
}
