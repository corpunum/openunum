/**
 * E2E Tests: Hippocampal Replay / Memory Consolidation (R2)
 * 
 * Direct module tests for pattern extraction and consolidation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MemoryConsolidator } from '../../src/core/memory-consolidator.mjs';

// Create in-memory test DB with route_lessons table
function createTestStore() {
  const db = new DatabaseSync(':memory:');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT DEFAULT '',
      artifact_type TEXT DEFAULT '',
      content TEXT DEFAULT '',
      source_ref TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS route_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT DEFAULT '',
      goal_hint TEXT DEFAULT '',
      route_signature TEXT DEFAULT '',
      surface TEXT DEFAULT '',
      outcome TEXT DEFAULT '',
      error_excerpt TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT DEFAULT '',
      value TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal TEXT DEFAULT '',
      strategy TEXT DEFAULT '',
      success INTEGER DEFAULT 0,
      evidence TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT DEFAULT '',
      ok INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Mimic the MemoryStore API
  return {
    db,
    getRouteLessons({ since = null, tool = null, limit = 200 } = {}) {
      let query = 'SELECT * FROM route_lessons WHERE 1=1';
      const params = [];
      if (since) { query += ' AND created_at >= ?'; params.push(since); }
      if (tool) { query += ' AND surface = ?'; params.push(tool); }
      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      return db.prepare(query).all(...params);
    },
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
        weight: pattern.weight || 1.5
      });
      const result = db.prepare(
        'INSERT INTO memory_artifacts (session_id, artifact_type, content, source_ref, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('consolidator', 'consolidated', content, `pattern:${pattern.pattern}`, now);
      return { ok: true, id: result.lastInsertRowid };
    },
    getConsolidatedPatterns({ limit = 50 } = {}) {
      const rows = db.prepare(
        'SELECT id, content, created_at FROM memory_artifacts WHERE artifact_type = ? ORDER BY created_at DESC LIMIT ?'
      ).all('consolidated', limit);
      return rows.map(r => {
        try { return JSON.parse(r.content); } catch { return null; }
      }).filter(Boolean);
    }
  };
}

// Insert test route lessons
function insertRouteLessons(store, lessons) {
  for (const lesson of lessons) {
    store.db.prepare(
      `INSERT INTO route_lessons (session_id, goal_hint, route_signature, surface, outcome, error_excerpt, note, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      lesson.sessionId || 'test-session',
      lesson.goalHint || '',
      lesson.routeSignature || '',
      lesson.surface || '',
      lesson.outcome || 'success',
      lesson.errorExcerpt || '',
      lesson.note || '',
      lesson.createdAt || new Date().toISOString()
    );
  }
}

describe('Hippocampal Replay (R2)', () => {
  let store, consolidator;

  describe('pattern extraction', () => {
    it('identifies success patterns from route_lessons', () => {
      store = createTestStore();
      insertRouteLessons(store, [
        { surface: 'web_fetch', outcome: 'success', routeSignature: 'fetch-url', goalHint: 'scrape page' },
        { surface: 'web_fetch', outcome: 'success', routeSignature: 'fetch-url', goalHint: 'scrape page' },
        { surface: 'web_fetch', outcome: 'success', routeSignature: 'fetch-url', goalHint: 'scrape page' },
        { surface: 'web_search', outcome: 'success', routeSignature: 'search-web', goalHint: 'find info' },
      ]);
      
      consolidator = new MemoryConsolidator({ store, minSuccessesForPattern: 3, minFailuresForPattern: 2 });
      const result = consolidator.runReplayCycle();
      
      assert.ok(result.successPatterns.length >= 1, `Expected >=1 success patterns, got ${result.successPatterns.length}`);
      const webFetchPattern = result.successPatterns.find(p => p.surface === 'web_fetch');
      assert.ok(webFetchPattern, 'Should find web_fetch success pattern');
      assert.ok(webFetchPattern.count >= 3, `Expected count >=3, got ${webFetchPattern.count}`);
    });

    it('identifies failure patterns from route_lessons', () => {
      store = createTestStore();
      insertRouteLessons(store, [
        { surface: 'shell', outcome: 'failure', routeSignature: 'run-cmd', goalHint: 'run test', errorExcerpt: 'command not found' },
        { surface: 'shell', outcome: 'failure', routeSignature: 'run-cmd', goalHint: 'run test', errorExcerpt: 'permission denied' },
      ]);
      
      consolidator = new MemoryConsolidator({ store, minSuccessesForPattern: 3, minFailuresForPattern: 2 });
      const result = consolidator.runReplayCycle();
      
      assert.ok(result.failurePatterns.length >= 1, `Expected >=1 failure patterns, got ${result.failurePatterns.length}`);
      const shellFailure = result.failurePatterns.find(p => p.surface === 'shell');
      assert.ok(shellFailure, 'Should find shell failure pattern');
    });
  });

  describe('pattern consolidation', () => {
    it('stores consolidated patterns with boosted weight', () => {
      store = createTestStore();
      const pattern = {
        pattern: 'web_fetch:fetch-url:success',
        successes: 5,
        failures: 1,
        surface: 'web_fetch',
        outcome: 'success',
        examples: ['fetch-url', 'fetch-url', 'fetch-url'],
        weight: 1.5
      };
      
      const result = store.storeConsolidatedPattern(pattern);
      assert.ok(result.ok, 'Should store pattern');
      assert.ok(result.id > 0, 'Should have ID');
      
      const stored = store.getConsolidatedPatterns();
      assert.ok(stored.length === 1, 'Should retrieve 1 consolidated pattern');
      assert.strictEqual(stored[0].pattern, 'web_fetch:fetch-url:success');
      assert.ok(stored[0].weight >= 1.5, `Expected weight >=1.5, got ${stored[0].weight}`);
    });

    it('integration: consolidator stores patterns via store', () => {
      store = createTestStore();
      insertRouteLessons(store, [
        { surface: 'web_fetch', outcome: 'success', routeSignature: 'fetch-url' },
        { surface: 'web_fetch', outcome: 'success', routeSignature: 'fetch-url' },
        { surface: 'web_fetch', outcome: 'success', routeSignature: 'fetch-url' },
      ]);
      
      consolidator = new MemoryConsolidator({ store, minSuccessesForPattern: 3 });
      const cycle = consolidator.runReplayCycle();
      
      for (const pattern of cycle.successPatterns) {
        store.storeConsolidatedPattern(pattern);
      }
      
      const stored = store.getConsolidatedPatterns();
      assert.ok(stored.length >= 1, 'Should have stored consolidated patterns');
      assert.strictEqual(stored[0].successes, 3);
    });
  });

  describe('loop prevention', () => {
    it('does not re-consolidate same pattern in same cycle', () => {
      store = createTestStore();
      insertRouteLessons(store, [
        { surface: 'web_fetch', outcome: 'success', routeSignature: 'fetch-url' },
        { surface: 'web_fetch', outcome: 'success', routeSignature: 'fetch-url' },
        { surface: 'web_fetch', outcome: 'success', routeSignature: 'fetch-url' },
      ]);
      
      consolidator = new MemoryConsolidator({ store, minSuccessesForPattern: 3 });
      
      // First cycle
      const cycle1 = consolidator.runReplayCycle();
      assert.ok(cycle1.successPatterns.length >= 1);
      for (const p of cycle1.successPatterns) store.storeConsolidatedPattern(p);
      
      // Second cycle with same data should not re-find the same pattern
      const cycle2 = consolidator.runReplayCycle();
      const alreadyConsolidated = cycle2.successPatterns.filter(p => 
        p.pattern === cycle1.successPatterns[0]?.pattern
      );
      assert.ok(alreadyConsolidated.length === 0, 'Should not re-consolidate same pattern');
    });
  });

  describe('failure patterns', () => {
    it('flags failure patterns correctly', () => {
      store = createTestStore();
      insertRouteLessons(store, [
        { surface: 'browser', outcome: 'failure', routeSignature: 'navigate', errorExcerpt: 'timeout' },
        { surface: 'browser', outcome: 'failure', routeSignature: 'navigate', errorExcerpt: 'connection refused' },
      ]);
      
      consolidator = new MemoryConsolidator({ store, minFailuresForPattern: 2 });
      const result = consolidator.runReplayCycle();
      
      assert.ok(result.failurePatterns.length >= 1);
      const browserFail = result.failurePatterns.find(p => p.surface === 'browser');
      assert.ok(browserFail, 'Should flag browser failures');
      assert.ok(browserFail.count >= 2, `Expected count >=2, got ${browserFail.count}`);
    });

    it('stores failure patterns for prevention', () => {
      store = createTestStore();
      insertRouteLessons(store, [
        { surface: 'shell', outcome: 'failure', routeSignature: 'exec', errorExcerpt: 'ENOENT' },
        { surface: 'shell', outcome: 'failure', routeSignature: 'exec', errorExcerpt: 'ENOENT' },
      ]);
      
      consolidator = new MemoryConsolidator({ store, minFailuresForPattern: 2 });
      const result = consolidator.runReplayCycle();
      
      for (const pattern of result.failurePatterns) {
        store.storeConsolidatedPattern({ ...pattern, weight: 0.5 }); // Lower weight for failures
      }
      
      const stored = store.getConsolidatedPatterns();
      assert.ok(stored.length >= 1);
      assert.ok(stored[0].failures >= 2, 'Should record failure count');
    });
  });

  describe('empty data handling', () => {
    it('handles no route_lessons gracefully', () => {
      store = createTestStore();
      consolidator = new MemoryConsolidator({ store });
      const result = consolidator.runReplayCycle();
      
      assert.ok(Array.isArray(result.successPatterns), 'Should return array');
      assert.ok(Array.isArray(result.failurePatterns), 'Should return array');
      assert.strictEqual(result.successPatterns.length, 0);
      assert.strictEqual(result.failurePatterns.length, 0);
    });
  });
});
