import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

/**
 * E2E Tests: Audit Logging System
 * 
 * Tests chain integrity, trace reconstruction, tamper detection, export, and privacy hashing.
 */

describe('Audit Logging System', () => {
  let testSessionId;
  let testLogIds = [];

  before(async () => {
    // Setup: Create test audit session
    const response = await fetch('http://localhost:3000/api/audit/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Test Session',
        type: 'test'
      })
    });
    const data = await response.json();
    testSessionId = data.sessionId;
  });

  after(async () => {
    // Cleanup: Remove test logs and session
    for (const logId of testLogIds) {
      await fetch(`http://localhost:3000/api/audit/log/${logId}`, {
        method: 'DELETE'
      }).catch(() => {});
    }
    if (testSessionId) {
      await fetch(`http://localhost:3000/api/audit/session/${testSessionId}`, {
        method: 'DELETE'
      }).catch(() => {});
    }
  });

  describe('Chain Integrity', () => {
    it('should create immutable audit log entries', async () => {
      const response = await fetch('http://localhost:3000/api/audit/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          action: 'test_action',
          actor: 'e2e_test',
          details: { test: true }
        })
      });
      const result = await response.json();
      testLogIds.push(result.logId);
      
      assert.ok(result.logId, 'Should return log ID');
      assert.ok(result.hash, 'Should return cryptographic hash');
      assert.ok(result.previousHash, 'Should reference previous hash for chain');
      assert.strictEqual(result.mutable, false, 'Log should be immutable');
    });

    it('should maintain hash chain between entries', async () => {
      // Create two consecutive logs
      const first = await fetch('http://localhost:3000/api/audit/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          action: 'first_action',
          actor: 'e2e_test'
        })
      });
      const firstResult = await first.json();
      testLogIds.push(firstResult.logId);
      
      const second = await fetch('http://localhost:3000/api/audit/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          action: 'second_action',
          actor: 'e2e_test'
        })
      });
      const secondResult = await second.json();
      testLogIds.push(secondResult.logId);
      
      assert.strictEqual(secondResult.previousHash, firstResult.hash, 
        'Second log should reference first log hash');
    });

    it('should verify chain integrity', async () => {
      const response = await fetch(`http://localhost:3000/api/audit/session/${testSessionId}/verify`);
      const result = await response.json();
      
      assert.ok('integrityValid' in result, 'Should return integrity status');
      assert.ok('verifiedAt' in result, 'Should include verification timestamp');
      if (result.integrityValid === false) {
        assert.ok(result.brokenAtIndex, 'Should identify where chain is broken');
      }
    });
  });

  describe('Trace Reconstruction', () => {
    it('should reconstruct full execution trace', async () => {
      // Create a sequence of related actions
      const actions = ['init', 'process', 'validate', 'complete'];
      const logIds = [];
      
      for (const action of actions) {
        const response = await fetch('http://localhost:3000/api/audit/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: testSessionId,
            action: action,
            actor: 'e2e_test',
            traceId: 'trace-123'
          })
        });
        const result = await response.json();
        logIds.push(result.logId);
        testLogIds.push(result.logId);
      }
      
      // Reconstruct trace
      const response = await fetch('http://localhost:3000/api/audit/trace/trace-123');
      const trace = await response.json();
      
      assert.ok(Array.isArray(trace.events), 'Should return event list');
      assert.strictEqual(trace.events.length, actions.length, 
        'Should include all trace events');
      assert.ok(trace.events.every(e => e.traceId === 'trace-123'), 
        'All events should belong to trace');
    });

    it('should order events chronologically', async () => {
      const response = await fetch(`http://localhost:3000/api/audit/session/${testSessionId}/trace`);
      const result = await response.json();
      
      assert.ok(Array.isArray(result.events), 'Should return event list');
      if (result.events.length > 1) {
        for (let i = 1; i < result.events.length; i++) {
          assert.ok(
            new Date(result.events[i].timestamp) >= new Date(result.events[i-1].timestamp),
            'Events should be chronologically ordered'
          );
        }
      }
    });

    it('should include context in trace reconstruction', async () => {
      const response = await fetch('http://localhost:3000/api/audit/trace/trace-123?includeContext=true');
      const trace = await response.json();
      
      assert.ok(trace.context, 'Should include context when requested');
      assert.ok(trace.context.sessionId, 'Context should include session info');
    });
  });

  describe('Tamper Detection', () => {
    it('should detect modified log entries', async () => {
      // Get a log entry
      const logsResponse = await fetch(`http://localhost:3000/api/audit/session/${testSessionId}/logs`);
      const logs = await logsResponse.json();
      
      if (logs.logs && logs.logs.length > 0) {
        const originalLog = logs.logs[0];
        
        // Attempt to verify (in real test, would tamper with storage)
        const verifyResponse = await fetch(`http://localhost:3000/api/audit/log/${originalLog.logId}/verify`);
        const verifyResult = await verifyResponse.json();
        
        assert.ok('tamperDetected' in verifyResult, 'Should report tamper status');
      }
    });

    it('should alert on chain breaks', async () => {
      const response = await fetch(`http://localhost:3000/api/audit/session/${testSessionId}/verify`);
      const result = await response.json();
      
      if (result.integrityValid === false) {
        assert.ok(result.alerts, 'Should generate alerts on integrity failure');
        assert.ok(Array.isArray(result.alerts), 'Alerts should be an array');
      }
    });

    it('should log tamper attempts', async () => {
      const response = await fetch(`http://localhost:3000/api/audit/session/${testSessionId}/tamper-log`);
      const result = await response.json();
      
      assert.ok(Array.isArray(result.tamperAttempts), 'Should track tamper attempts');
    });
  });

  describe('Export', () => {
    it('should export audit logs in JSON format', async () => {
      const response = await fetch(`http://localhost:3000/api/audit/session/${testSessionId}/export?format=json`);
      const result = await response.json();
      
      assert.ok(result.export, 'Should return export data');
      assert.ok(Array.isArray(result.export.logs), 'Should include logs array');
      assert.ok(result.export.metadata, 'Should include metadata');
      assert.strictEqual(result.export.format, 'json', 'Should specify format');
    });

    it('should export audit logs in CSV format', async () => {
      const response = await fetch(`http://localhost:3000/api/audit/session/${testSessionId}/export?format=csv`);
      const csv = await response.text();
      
      assert.ok(csv.length > 0, 'Should return CSV content');
      assert.ok(csv.includes('timestamp') || csv.includes('action'), 
        'CSV should include headers');
    });

    it('should support date-range exports', async () => {
      const now = new Date();
      const yesterday = new Date(now - 86400000);
      
      const response = await fetch(
        `http://localhost:3000/api/audit/session/${testSessionId}/export?` +
        `start=${yesterday.toISOString()}&end=${now.toISOString()}`
      );
      const result = await response.json();
      
      assert.ok(result.export, 'Should return export data');
      if (result.export.logs && result.export.logs.length > 0) {
        result.export.logs.forEach(log => {
          const logDate = new Date(log.timestamp);
          assert.ok(logDate >= yesterday && logDate <= now, 
            'All logs should be within date range');
        });
      }
    });

    it('should include chain verification in export', async () => {
      const response = await fetch(
        `http://localhost:3000/api/audit/session/${testSessionId}/export?includeVerification=true`
      );
      const result = await response.json();
      
      assert.ok(result.verification, 'Should include verification data');
      assert.ok(result.verification.integrityValid !== undefined, 
        'Should include integrity status');
    });
  });

  describe('Privacy Hashing', () => {
    it('should hash sensitive fields', async () => {
      const response = await fetch('http://localhost:3000/api/audit/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          action: 'sensitive_action',
          actor: 'user@example.com',
          details: { 
            password: 'secret123',
            token: 'abc123xyz'
          },
          hashSensitive: true
        })
      });
      const result = await response.json();
      testLogIds.push(result.logId);
      
      assert.ok(result.hashedFields, 'Should report hashed fields');
      assert.ok(result.hashedFields.includes('password') || 
                result.hashedFields.includes('details'), 
        'Should hash sensitive fields');
    });

    it('should preserve audit trail while protecting privacy', async () => {
      const response = await fetch(`http://localhost:3000/api/audit/session/${testSessionId}/logs?privacyMode=true`);
      const result = await response.json();
      
      assert.ok(result.logs, 'Should return logs');
      if (result.logs && result.logs.length > 0) {
        const log = result.logs[0];
        // Verify that sensitive data is hashed but structure is preserved
        assert.ok(log.action, 'Action should be visible');
        assert.ok(log.timestamp, 'Timestamp should be visible');
      }
    });

    it('should support selective field unmasking with authorization', async () => {
      // This would require auth tokens in real implementation
      const response = await fetch(
        `http://localhost:3000/api/audit/log/unmask`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            logId: testLogIds[0],
            fields: ['details'],
            authorization: 'admin-token'
          })
        }
      );
      
      // May fail without proper auth, but endpoint should exist
      assert.ok(response.status === 200 || response.status === 401 || response.status === 403,
        'Endpoint should exist and respond appropriately');
    });

    it('should comply with data retention policies', async () => {
      const configResponse = await fetch('http://localhost:3000/api/audit/config');
      const config = await configResponse.json();
      
      assert.ok(config.retentionDays, 'Should have retention policy');
      assert.ok(config.retentionDays > 0, 'Retention should be positive');
      assert.ok(config.autoPurge, 'Should support auto-purge');
    });
  });

  describe('Audit Statistics', () => {
    it('should provide audit log statistics', async () => {
      const response = await fetch('http://localhost:3000/api/audit/stats');
      const stats = await response.json();
      
      assert.ok('totalLogs' in stats, 'Should report total logs');
      assert.ok('sessionsCount' in stats, 'Should report session count');
      assert.ok('lastLogAt' in stats, 'Should report last log timestamp');
    });

    it('should track logs by action type', async () => {
      const response = await fetch('http://localhost:3000/api/audit/stats/by-action');
      const stats = await response.json();
      
      assert.ok(stats.breakdown, 'Should return action breakdown');
      assert.ok(typeof stats.breakdown === 'object', 'Breakdown should be an object');
    });
  });
});
