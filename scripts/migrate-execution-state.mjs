#!/usr/bin/env node
/**
 * Migration script: Consolidate task_records + mission_records → execution_state
 * 
 * Usage: node scripts/migrate-execution-state.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Determine DB path from environment or default
const dbPath = process.env.OPENUNUM_DB || path.join(process.env.HOME, '.openunum', 'openunum.db');

console.log(`🔧 Migration: execution_state consolidation`);
console.log(`📁 Database: ${dbPath}`);

const db = new DatabaseSync(dbPath);

// Step 0: Drop existing execution_state (for re-runs)
console.log('\n📋 Step 0: Dropping existing execution_state (if any)...');
db.exec('DROP TABLE IF EXISTS execution_state');

// Step 1: Create execution_state table
console.log('\n📋 Step 1: Creating execution_state table...');
db.exec(`
  CREATE TABLE execution_state (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('task', 'mission')),
    goal TEXT NOT NULL,
    status TEXT NOT NULL,
    session_id TEXT NOT NULL,
    
    -- Common fields
    step INTEGER DEFAULT 0,
    max_steps INTEGER DEFAULT 0,
    step_done_count INTEGER DEFAULT 0,
    step_failed_count INTEGER DEFAULT 0,
    retries INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 0,
    error TEXT,
    
    -- Task-specific fields
    continue_on_failure INTEGER DEFAULT 0,
    verify_count INTEGER DEFAULT 0,
    verify_failed_count INTEGER DEFAULT 0,
    monitor_count INTEGER DEFAULT 0,
    
    -- Mission-specific fields
    hard_step_cap INTEGER DEFAULT 0,
    interval_ms INTEGER DEFAULT 0,
    continue_until_done INTEGER DEFAULT 1,
    
    -- Timestamps
    created_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    updated_at TEXT NOT NULL,
    
    -- Full JSON snapshot
    state_json TEXT NOT NULL
  );
  
  CREATE INDEX IF NOT EXISTS idx_execution_state_type_status ON execution_state(type, status);
  CREATE INDEX IF NOT EXISTS idx_execution_state_session_updated ON execution_state(session_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_execution_state_created ON execution_state(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_execution_state_status_updated ON execution_state(status, updated_at DESC);
`);
console.log('✅ execution_state table created with indexes');

// Step 2: Migrate task_records using INSERT ... SELECT
console.log('\n📋 Step 2: Migrating task_records via INSERT ... SELECT...');
db.exec(`
  INSERT INTO execution_state (
    id, type, goal, status, session_id,
    step_done_count, step_failed_count,
    continue_on_failure, verify_count, verify_failed_count, monitor_count,
    error, created_at, started_at, finished_at, updated_at, state_json
  )
  SELECT 
    id, 'task', goal, status, session_id,
    step_done_count, step_failed_count,
    continue_on_failure, verify_count, verify_failed_count, monitor_count,
    error, created_at, started_at, finished_at, updated_at, task_json
  FROM task_records
`);
const taskCount = db.prepare("SELECT COUNT(*) as c FROM execution_state WHERE type = 'task'").get().c;
console.log(`✅ Migrated ${taskCount} task_records`);

// Step 3: Migrate mission_records using INSERT ... SELECT
console.log('\n📋 Step 3: Migrating mission_records via INSERT ... SELECT...');
db.exec(`
  INSERT INTO execution_state (
    id, type, goal, status, session_id,
    step, max_steps, hard_step_cap, retries, max_retries, interval_ms, continue_until_done,
    error, created_at, started_at, finished_at, updated_at, state_json
  )
  SELECT 
    id, 'mission', goal, status, session_id,
    step, max_steps, hard_step_cap, retries, max_retries, interval_ms, continue_until_done,
    error, started_at, started_at, finished_at, updated_at, mission_json
  FROM mission_records
  WHERE mission_json IS NOT NULL AND mission_json != ''
`);
const missionCount = db.prepare("SELECT COUNT(*) as c FROM execution_state WHERE type = 'mission'").get().c;
console.log(`✅ Migrated ${missionCount} mission_records`);

// Step 4: Verify migration
console.log('\n📋 Step 4: Verifying migration...');
const origTaskCount = db.prepare("SELECT COUNT(*) as c FROM task_records").get().c;
const origMissionCount = db.prepare("SELECT COUNT(*) as c FROM mission_records WHERE mission_json IS NOT NULL AND mission_json != ''").get().c;

console.log(`📊 execution_state totals: ${taskCount} tasks, ${missionCount} missions`);
console.log(`📊 Original totals: ${origTaskCount} tasks, ${origMissionCount} missions`);

if (taskCount !== origTaskCount || missionCount !== origMissionCount) {
  console.error('❌ Migration count mismatch!');
  console.error(`   Tasks: expected ${origTaskCount}, got ${taskCount}`);
  console.error(`   Missions: expected ${origMissionCount}, got ${missionCount}`);
  process.exit(1);
}

// Step 5: Show sample data
console.log('\n📋 Sample execution_state records:');
const samples = db.prepare('SELECT id, type, goal, status, session_id, created_at FROM execution_state ORDER BY created_at DESC LIMIT 3').all();
for (const s of samples) {
  console.log(`  - [${s.type}] ${s.id.slice(0, 8)}... | ${s.status} | ${s.goal.slice(0, 50)}...`);
}

// Step 6: Verify JSON is valid
console.log('\n📋 Step 6: Verifying JSON validity...');
const invalidJson = db.prepare(`
  SELECT id, type, state_json 
  FROM execution_state 
  WHERE json_valid(state_json) = 0
`).all();
if (invalidJson.length > 0) {
  console.error(`❌ Found ${invalidJson.length} records with invalid JSON`);
  for (const r of invalidJson) {
    console.error(`   ${r.type}:${r.id.slice(0, 8)}...`);
  }
  process.exit(1);
}
console.log('✅ All state_json values are valid JSON');

console.log('\n✅ Migration complete!');
console.log('📝 Next steps:');
console.log('   1. Update src/memory/store.mjs to add execution_state methods');
console.log('   2. Update src/core/agent.mjs to use execution_state as single source of truth');
console.log('   3. Test thoroughly before considering removal of old tables');

db.close();
