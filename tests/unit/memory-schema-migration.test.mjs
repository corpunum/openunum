import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeMemoryStoreSchema } from '../../src/memory/store-schema.mjs';

const tempPaths = [];

afterEach(() => {
  while (tempPaths.length) {
    const filePath = tempPaths.pop();
    fs.rmSync(filePath, { force: true });
  }
});

function makeTempDb() {
  const filePath = path.join(os.tmpdir(), `openunum-memory-schema-${Date.now()}-${Math.random()}.sqlite`);
  tempPaths.push(filePath);
  return new DatabaseSync(filePath);
}

describe('memory schema migration', () => {
  it('adds session query indexes when upgrading a legacy schema', () => {
    const db = makeTempDb();
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE session_compactions (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, cutoff_message_id INTEGER NOT NULL, model TEXT NOT NULL, ctx_limit INTEGER NOT NULL, pre_tokens INTEGER NOT NULL, post_tokens INTEGER NOT NULL, summary_json TEXT NOT NULL, created_at TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);

    initializeMemoryStoreSchema(db);

    const indexes = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
      ORDER BY name ASC
    `).all().map((row) => row.name);
    const version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);

    expect(version).toBe(3);
    expect(indexes).toContain('idx_messages_session_id_id');
    expect(indexes).toContain('idx_messages_session_role_id');
    expect(indexes).toContain('idx_session_compactions_session_id_id');
  });
});
