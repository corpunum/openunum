/**
 * E2E Tests: Audit Logging System
 * 
 * Tests:
 * 1. Chain integrity - log 5 events, verify chain, check integrity
 * 2. Tamper detection - tamper with file, verify chain detects break
 * 3. Merkle root - verify merkle root changes on new entries
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';

// Import the audit log module directly for testing
import {
  logEvent,
  verifyChain,
  getLog,
  getMerkleRoot,
  clearAuditLog,
  getAuditStats,
  AUDIT_LOG_PATH
} from '../../src/core/audit-log.mjs';

describe('Audit Logging System', () => {
  let originalAuditContent = null;
  
  before(() => {
    originalAuditContent = fs.existsSync(AUDIT_LOG_PATH)
      ? fs.readFileSync(AUDIT_LOG_PATH, 'utf8')
      : null;
    if (fs.existsSync(AUDIT_LOG_PATH)) {
      fs.unlinkSync(AUDIT_LOG_PATH);
    }
  });
  
  after(() => {
    if (originalAuditContent === null) {
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      return;
    }
    fs.writeFileSync(AUDIT_LOG_PATH, originalAuditContent, 'utf8');
  });

  describe('Chain Integrity', () => {
    it('should log 5 events and verify chain integrity', () => {
      // Clear any existing entries
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      
      // Log 5 events
      const events = [];
      for (let i = 0; i < 5; i++) {
        const entry = logEvent('tool_call', { action: `test_action_${i}`, index: i }, `corr-${i}`);
        events.push(entry);
      }
      
      // Verify all entries were created
      assert.strictEqual(events.length, 5, 'Should have 5 entries');
      events.forEach((entry, i) => {
        assert.ok(entry.entryId, `Entry ${i} should have entryId`);
        assert.ok(entry.timestamp, `Entry ${i} should have timestamp`);
        assert.strictEqual(entry.eventType, 'tool_call', `Entry ${i} should be tool_call`);
        assert.ok(entry.previousHash, `Entry ${i} should have previousHash`);
        assert.ok(entry.currentHash, `Entry ${i} should have currentHash`);
      });
      
      // First entry should have genesis previousHash
      assert.strictEqual(events[0].previousHash, '0'.repeat(64), 'First entry should have genesis previousHash');
      
      // Verify chain
      const verification = verifyChain();
      assert.strictEqual(verification.valid, true, 'Chain should be valid');
      assert.strictEqual(verification.brokenAt, null, 'Should have no broken entry');
    });

    it('should maintain hash chain between consecutive entries', () => {
      // Clear log
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      
      // Create first entry
      const first = logEvent('state_change', { from: 'init', to: 'running' }, 'corr-1');
      
      // Create second entry - should have first entry's hash as previousHash
      const second = logEvent('state_change', { from: 'running', to: 'complete' }, 'corr-2');
      
      assert.strictEqual(second.previousHash, first.currentHash, 
        'Second entry should reference first entry hash as previousHash');
      
      // Verify chain is valid
      const verification = verifyChain();
      assert.strictEqual(verification.valid, true, 'Chain should be valid after two entries');
    });

    it('should detect modification of any entry', () => {
      // Clear log
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      
      // Log an event
      const entry = logEvent('config_mutation', { key: 'test', value: 'original' }, 'corr-mod');
      const originalHash = entry.currentHash;
      
      // Read the log file
      const content = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
      const lines = content.trim().split('\n');
      assert.ok(lines.length > 0, 'Should have at least one line');
      
      // Tamper with the middle of the file (change payload)
      const tamperedLines = lines.map(line => {
        try {
          const parsed = JSON.parse(line);
          if (parsed.correlationId === 'corr-mod') {
            // Change the payload
            parsed.payload = { key: 'test', value: 'TAMPERED' };
            return JSON.stringify(parsed);
          }
          return line;
        } catch {
          return line;
        }
      });
      
      fs.writeFileSync(AUDIT_LOG_PATH, tamperedLines.join('\n') + '\n', 'utf8');
      
      // Verify should detect the tamper
      const verification = verifyChain();
      assert.strictEqual(verification.valid, false, 'Chain should be invalid after tampering');
      assert.ok(verification.brokenAt !== null, 'Should identify broken entry index');
    });

    it('should detect deletion of an entry', () => {
      // Clear log
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      
      // Log 3 events
      logEvent('tool_call', { action: 'first' }, 'corr-del-1');
      logEvent('tool_call', { action: 'second' }, 'corr-del-2');
      const third = logEvent('tool_call', { action: 'third' }, 'corr-del-3');
      
      // Delete the middle entry by rewriting without it
      const content = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
      const lines = content.trim().split('\n');
      const tamperedLines = lines.filter(line => {
        try {
          const parsed = JSON.parse(line);
          return parsed.correlationId !== 'corr-del-2';
        } catch {
          return true;
        }
      });
      
      fs.writeFileSync(AUDIT_LOG_PATH, tamperedLines.join('\n') + '\n', 'utf8');
      
      // Verify should detect chain break
      const verification = verifyChain();
      assert.strictEqual(verification.valid, false, 'Chain should be invalid after deletion');
    });
  });

  describe('Merkle Root', () => {
    it('should compute merkle root every N entries', () => {
      // Clear log
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      
      // Log exactly 10 entries (merkle interval)
      for (let i = 0; i < 10; i++) {
        logEvent('verification', { index: i }, `merkle-corr-${i}`);
      }
      
      // Get merkle root
      const merkleRoot = getMerkleRoot();
      assert.ok(merkleRoot, 'Should have a merkle root after 10 entries');
      assert.strictEqual(typeof merkleRoot, 'string', 'Merkle root should be a string');
      assert.strictEqual(merkleRoot.length, 64, 'Merkle root should be 64 hex chars (SHA256)');
      
      // Log one more entry - merkle root should change
      const beforeRoot = getMerkleRoot();
      logEvent('verification', { index: 10 }, 'merkle-corr-10');
      
      // The merkle root computation is based on count, so after 11 entries 
      // without hitting the next interval (20), it should still be based on the 
      // merkle root entry created at 10
      // Actually, getMerkleRoot returns the last stored merkle root entry
      // So after 11 entries, the stored merkle root is still the one from entry 10
      const afterRoot = getMerkleRoot();
      assert.strictEqual(beforeRoot, afterRoot, 'Merkle root should remain same until next interval');
    });

    it('should produce different merkle root for different entry sets', () => {
      // Clear log
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      
      // Log 10 entries with specific data
      for (let i = 0; i < 10; i++) {
        logEvent('tool_call', { uniqueData: `set1-${i}` }, `set1-corr-${i}`);
      }
      
      const root1 = getMerkleRoot();
      
      // Clear and log 10 different entries
      fs.unlinkSync(AUDIT_LOG_PATH);
      
      for (let i = 0; i < 10; i++) {
        logEvent('tool_call', { uniqueData: `set2-${i}` }, `set2-corr-${i}`);
      }
      
      const root2 = getMerkleRoot();
      
      assert.notStrictEqual(root1, root2, 'Different entry sets should produce different merkle roots');
    });
  });

  describe('Log Retrieval', () => {
    it('should retrieve all entries by default', () => {
      // Clear log
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      
      // Log 5 entries
      for (let i = 0; i < 5; i++) {
        logEvent('tool_call', { index: i }, `retrieve-corr-${i}`);
      }
      
      const entries = getLog({});
      assert.ok(entries.length >= 5, 'Should have at least 5 entries');
    });

    it('should filter by event type', () => {
      // Clear log
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      
      // Log mixed event types
      logEvent('tool_call', { action: 'tc1' }, 'type-corr-1');
      logEvent('state_change', { from: 'a', to: 'b' }, 'type-corr-2');
      logEvent('tool_call', { action: 'tc2' }, 'type-corr-3');
      logEvent('config_mutation', { key: 'k', value: 'v' }, 'type-corr-4');
      
      const toolCalls = getLog({ type: 'tool_call' });
      assert.ok(toolCalls.length >= 2, 'Should have at least 2 tool_call entries');
      toolCalls.forEach(entry => {
        assert.strictEqual(entry.eventType, 'tool_call', 'All entries should be tool_call');
      });
      
      const stateChanges = getLog({ type: 'state_change' });
      assert.ok(stateChanges.length >= 1, 'Should have at least 1 state_change entry');
      stateChanges.forEach(entry => {
        assert.strictEqual(entry.eventType, 'state_change', 'All entries should be state_change');
      });
    });

    it('should filter by timestamp (since)', () => {
      const before = new Date().toISOString();
      
      logEvent('tool_call', { action: 'after' }, 'time-corr-after');
      
      const sinceEntries = getLog({ since: before });
      assert.ok(sinceEntries.length >= 1, 'Should have entries after timestamp');
      sinceEntries.forEach(entry => {
        const entryTime = new Date(entry.timestamp);
        const sinceTime = new Date(before);
        assert.ok(entryTime >= sinceTime, 'Entry should be after since timestamp');
      });
    });

    it('should apply limit to results', () => {
      // Clear log
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      
      // Log 20 entries
      for (let i = 0; i < 20; i++) {
        logEvent('tool_call', { index: i }, `limit-corr-${i}`);
      }
      
      const limited = getLog({ limit: 5 });
      assert.strictEqual(limited.length, 5, 'Should return exactly 5 entries when limit is 5');
    });
  });

  describe('Event Types', () => {
    it('should accept valid event types', () => {
      const validTypes = ['tool_call', 'state_change', 'config_mutation', 'verification'];
      
      validTypes.forEach(type => {
        const entry = logEvent(type, { test: true }, `type-corr-${type}`);
        assert.strictEqual(entry.eventType, type, `Should accept event type: ${type}`);
      });
    });

    it('should reject invalid event types', () => {
      assert.throws(
        () => logEvent('invalid_type', { test: true }, 'bad-type-corr'),
        /Invalid event type/,
        'Should throw for invalid event type'
      );
    });
  });

  describe('Correlation IDs', () => {
    it('should generate correlationId if not provided', () => {
      const entry = logEvent('tool_call', { action: 'test' });
      assert.ok(entry.correlationId, 'Should auto-generate correlationId');
      assert.strictEqual(typeof entry.correlationId, 'string', 'correlationId should be a string');
    });

    it('should use provided correlationId', () => {
      const customCorrId = 'my-custom-correlation-id';
      const entry = logEvent('tool_call', { action: 'test' }, customCorrId);
      assert.strictEqual(entry.correlationId, customCorrId, 'Should use provided correlationId');
    });
  });

  describe('Audit Statistics', () => {
    it('should provide correct statistics', () => {
      // Clear log
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        fs.unlinkSync(AUDIT_LOG_PATH);
      }
      
      // Log 3 entries
      logEvent('tool_call', { a: 1 }, 'stats-corr-1');
      logEvent('tool_call', { b: 2 }, 'stats-corr-2');
      logEvent('state_change', { c: 3 }, 'stats-corr-3');
      
      const stats = getAuditStats();
      assert.ok(stats.totalEntries >= 3, 'Should report correct total entries');
      assert.ok(stats.byType.tool_call >= 2, 'Should count tool_call events');
      assert.ok(stats.byType.state_change >= 1, 'Should count state_change events');
      assert.ok(stats.firstEntry, 'Should have first entry timestamp');
      assert.ok(stats.lastEntry, 'Should have last entry timestamp');
    });
  });
});
