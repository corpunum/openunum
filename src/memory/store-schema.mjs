const MEMORY_STORE_SCHEMA_VERSION = 3;

function getSchemaVersion(db) {
  try {
    const row = db.prepare('PRAGMA user_version').get();
    return Number(row?.user_version || 0);
  } catch {
    return 0;
  }
}

export function initializeMemoryStoreSchema(db) {
  const currentVersion = getSchemaVersion(db);
  if (currentVersion < 1) {
    db.exec(`
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
CREATE TABLE IF NOT EXISTS channel_state (
  channel_name TEXT NOT NULL,
  state_key TEXT NOT NULL,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_name, state_key)
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
CREATE TABLE IF NOT EXISTS worker_records (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  run_count INTEGER NOT NULL,
  fail_count INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  worker_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_worker_records_status_updated ON worker_records(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_records_created ON worker_records(created_at DESC);
CREATE TABLE IF NOT EXISTS self_edit_records (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  session_id TEXT NOT NULL,
  last_error TEXT,
  changed_paths TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  run_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_self_edit_records_status_updated ON self_edit_records(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_self_edit_records_created ON self_edit_records(created_at DESC);
-- DEPRECATED: task_records and mission_records deprecated v2.1.0, use execution_state
CREATE TABLE IF NOT EXISTS execution_state (
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('task','mission')), goal TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT NOT NULL,
  step INTEGER DEFAULT 0, max_steps INTEGER DEFAULT 0, step_done_count INTEGER DEFAULT 0, step_failed_count INTEGER DEFAULT 0,
  retries INTEGER DEFAULT 0, max_retries INTEGER DEFAULT 0, error TEXT, continue_on_failure INTEGER DEFAULT 0,
  verify_count INTEGER DEFAULT 0, verify_failed_count INTEGER DEFAULT 0, monitor_count INTEGER DEFAULT 0,
  hard_step_cap INTEGER DEFAULT 0, interval_ms INTEGER DEFAULT 0, continue_until_done INTEGER DEFAULT 1,
  created_at TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, updated_at TEXT NOT NULL, state_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_execution_state_type_status ON execution_state(type, status);
CREATE INDEX IF NOT EXISTS idx_execution_state_session_updated ON execution_state(session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_state_created ON execution_state(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_state_status_updated ON execution_state(status, updated_at DESC);
`);
  }

  db.exec(`
CREATE INDEX IF NOT EXISTS idx_messages_session_id_id ON messages(session_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_role_id ON messages(session_id, role, id ASC);
CREATE INDEX IF NOT EXISTS idx_session_compactions_session_id_id ON session_compactions(session_id, id DESC);
`);

  // Always ensure columns exist (safe to run multiple times, handles version clobbering)
  const messageColumns = db.prepare("PRAGMA table_info(messages)").all().map(c => c.name);
  if (!messageColumns.includes('reasoning')) {
    db.exec('ALTER TABLE messages ADD COLUMN reasoning TEXT DEFAULT NULL');
  }
  if (!messageColumns.includes('raw_reply')) {
    db.exec('ALTER TABLE messages ADD COLUMN raw_reply TEXT DEFAULT NULL');
  }

  if (currentVersion < MEMORY_STORE_SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${MEMORY_STORE_SCHEMA_VERSION};`);
  }
}
