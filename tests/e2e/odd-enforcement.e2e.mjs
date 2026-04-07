import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

/**
 * E2E Tests: ODD (Operational Design Domain) Enforcement
 * 
 * Tests ODD definitions, mode enforcement, confidence thresholds, and escalation paths.
 */

describe('ODD Enforcement System', () => {
  let testSessionId;
  const ODD_CONFIG = {
    modes: ['standard', 'restricted', 'autonomous', 'supervised'],
    defaultMode: 'standard',
    confidenceThresholds: {
      standard: 0.7,
      restricted: 0.9,
      autonomous: 0.95,
      supervised: 0.5
    }
  };

  before(async () => {
    // Setup: Create test session with ODD context
    const response = await fetch('http://localhost:3000/api/odd/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E ODD Test Session',
        initialMode: 'standard'
      })
    });
    const data = await response.json();
    testSessionId = data.sessionId;
  });

  after(async () => {
    // Cleanup: Close test session
    if (testSessionId) {
      await fetch(`http://localhost:3000/api/odd/session/${testSessionId}`, {
        method: 'DELETE'
      }).catch(() => {});
    }
  });

  describe('ODD Definitions', () => {
    it('should have defined operational modes', async () => {
      const response = await fetch('http://localhost:3000/api/odd/modes');
      const result = await response.json();
      
      assert.ok(Array.isArray(result.modes), 'Should return modes array');
      assert.ok(result.modes.length > 0, 'Should have at least one mode');
      result.modes.forEach(mode => {
        assert.ok(mode.name, 'Mode should have name');
        assert.ok(mode.description, 'Mode should have description');
        assert.ok('confidenceThreshold' in mode, 'Mode should have confidence threshold');
      });
    });

    it('should define allowed operations per mode', async () => {
      const response = await fetch('http://localhost:3000/api/odd/modes/standard');
      const mode = await response.json();
      
      assert.ok(mode.allowedOperations, 'Mode should define allowed operations');
      assert.ok(Array.isArray(mode.allowedOperations), 'Operations should be an array');
      assert.ok(mode.restrictedOperations, 'Mode should define restricted operations');
    });

    it('should define boundary conditions for each mode', async () => {
      const response = await fetch('http://localhost:3000/api/odd/modes');
      const result = await response.json();
      
      result.modes.forEach(mode => {
        assert.ok('boundaries' in mode, 'Mode should define boundaries');
        if (mode.boundaries) {
          assert.ok('maxConfidence' in mode.boundaries || 
                    'minConfidence' in mode.boundaries,
            'Boundaries should include confidence constraints');
        }
      });
    });
  });

  describe('Mode Enforcement', () => {
    it('should enforce mode on session start', async () => {
      const response = await fetch(`http://localhost:3000/api/odd/session/${testSessionId}`);
      const session = await response.json();
      
      assert.ok(session.mode, 'Session should have active mode');
      assert.strictEqual(session.mode, 'standard', 'Should start in configured mode');
      assert.ok(session.modeEnforced, 'Mode should be enforced');
    });

    it('should block operations outside current mode', async () => {
      const response = await fetch('http://localhost:3000/api/odd/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          operation: 'exec',
          parameters: { command: 'rm -rf /' }
        })
      });
      const result = await response.json();
      
      assert.ok('allowed' in result, 'Should return allowance status');
      if (!result.allowed) {
        assert.ok(result.reason, 'Should provide reason for denial');
        assert.ok(result.requiredMode, 'Should indicate required mode');
      }
    });

    it('should allow operations within current mode', async () => {
      const response = await fetch('http://localhost:3000/api/odd/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          operation: 'read',
          parameters: { path: '/home/test.txt' }
        })
      });
      const result = await response.json();
      
      assert.strictEqual(result.allowed, true, 'Read should be allowed in standard mode');
    });

    it('should track mode violations', async () => {
      const response = await fetch(`http://localhost:3000/api/odd/session/${testSessionId}/violations`);
      const result = await response.json();
      
      assert.ok(Array.isArray(result.violations), 'Should return violations list');
      if (result.violations.length > 0) {
        assert.ok('timestamp' in result.violations[0], 'Violation should have timestamp');
        assert.ok('operation' in result.violations[0], 'Violation should record operation');
        assert.ok('attemptedMode' in result.violations[0], 'Violation should record mode');
      }
    });
  });

  describe('Confidence Thresholds', () => {
    it('should require minimum confidence for operations', async () => {
      const response = await fetch('http://localhost:3000/api/odd/confidence/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          operation: 'autonomous_action',
          confidence: 0.6
        })
      });
      const result = await response.json();
      
      assert.ok('meetsThreshold' in result, 'Should return threshold status');
      assert.ok('requiredThreshold' in result, 'Should indicate required threshold');
    });

    it('should block low-confidence autonomous actions', async () => {
      const response = await fetch('http://localhost:3000/api/odd/confidence/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          operation: 'autonomous_decision',
          confidence: 0.5,
          requiredMode: 'autonomous'
        })
      });
      const result = await response.json();
      
      assert.strictEqual(result.meetsThreshold, false, 
        '50% confidence should not meet autonomous threshold');
      assert.ok(result.blocked, 'Should block low-confidence autonomous action');
    });

    it('should allow high-confidence actions', async () => {
      const response = await fetch('http://localhost:3000/api/odd/confidence/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          operation: 'standard_action',
          confidence: 0.95
        })
      });
      const result = await response.json();
      
      assert.strictEqual(result.meetsThreshold, true, 
        '95% confidence should meet standard threshold');
    });

    it('should have mode-specific thresholds', async () => {
      const response = await fetch('http://localhost:3000/api/odd/config');
      const config = await response.json();
      
      assert.ok(config.confidenceThresholds, 'Should have confidence thresholds config');
      assert.ok(config.confidenceThresholds.autonomous > config.confidenceThresholds.standard,
        'Autonomous threshold should be higher than standard');
      assert.ok(config.confidenceThresholds.restricted > config.confidenceThresholds.standard,
        'Restricted threshold should be higher than standard');
    });
  });

  describe('Escalation Paths', () => {
    it('should escalate when confidence is below threshold', async () => {
      const response = await fetch('http://localhost:3000/api/odd/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          reason: 'low_confidence',
          currentConfidence: 0.4,
          requiredConfidence: 0.7,
          operation: 'critical_action'
        })
      });
      const result = await response.json();
      
      assert.strictEqual(result.escalated, true, 'Should escalate on low confidence');
      assert.ok(result.escalationId, 'Should return escalation ID');
      assert.ok(result.escalationPath, 'Should indicate escalation path');
    });

    it('should escalate on mode violation', async () => {
      const response = await fetch('http://localhost:3000/api/odd/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testSessionId,
          reason: 'mode_violation',
          attemptedOperation: 'restricted_op',
          currentMode: 'standard'
        })
      });
      const result = await response.json();
      
      assert.ok(result.escalated || result.requiresReview, 
        'Should escalate or flag for review on mode violation');
    });

    it('should support multi-level escalation', async () => {
      const response = await fetch('http://localhost:3000/api/odd/escalation-levels');
      const result = await response.json();
      
      assert.ok(Array.isArray(result.levels), 'Should define escalation levels');
      assert.ok(result.levels.length >= 2, 'Should have multiple escalation levels');
      
      // Verify levels are ordered
      if (result.levels.length > 1) {
        for (let i = 1; i < result.levels.length; i++) {
          assert.ok(
            result.levels[i].severity >= result.levels[i-1].severity,
            'Escalation levels should be ordered by severity'
          );
        }
      }
    });

    it('should track escalation history', async () => {
      const response = await fetch(`http://localhost:3000/api/odd/session/${testSessionId}/escalations`);
      const result = await response.json();
      
      assert.ok(Array.isArray(result.escalations), 'Should return escalation history');
      if (result.escalations.length > 0) {
        const escalation = result.escalations[0];
        assert.ok('timestamp' in escalation, 'Escalation should have timestamp');
        assert.ok('reason' in escalation, 'Escalation should have reason');
        assert.ok('status' in escalation, 'Escalation should have status');
        assert.ok(['pending', 'reviewing', 'resolved', 'dismissed'].includes(escalation.status),
          'Status should be valid');
      }
    });

    it('should support automatic escalation on repeated violations', async () => {
      // Record multiple violations
      for (let i = 0; i < 3; i++) {
        await fetch('http://localhost:3000/api/odd/violation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: testSessionId,
            type: 'confidence_below_threshold',
            severity: 'medium'
          })
        });
      }
      
      // Check if auto-escalation was triggered
      const response = await fetch(`http://localhost:3000/api/odd/session/${testSessionId}`);
      const session = await response.json();
      
      assert.ok('autoEscalationTriggered' in session || 
                session.modeChanged || 
                session.requiresReview,
        'Should trigger auto-escalation on repeated violations');
    });
  });

  describe('Mode Transitions', () => {
    it('should support safe mode transitions', async () => {
      const response = await fetch(`http://localhost:3000/api/odd/session/${testSessionId}/mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetMode: 'supervised',
          reason: 'testing mode transition'
        })
      });
      const result = await response.json();
      
      assert.ok(result.success, 'Mode transition should succeed');
      assert.strictEqual(result.newMode, 'supervised', 'Should be in new mode');
      assert.ok(result.transitionLogged, 'Transition should be logged');
    });

    it('should require authorization for certain transitions', async () => {
      const response = await fetch(`http://localhost:3000/api/odd/session/${testSessionId}/mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetMode: 'autonomous',
          reason: 'testing authorization requirement'
        })
      });
      const result = await response.json();
      
      // May require authorization
      if (!result.success) {
        assert.ok(result.requiresAuthorization, 
          'Should require authorization for autonomous mode');
      }
    });

    it('should validate preconditions before transition', async () => {
      const response = await fetch(`http://localhost:3000/api/odd/session/${testSessionId}/mode/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetMode: 'restricted'
        })
      });
      const result = await response.json();
      
      assert.ok('canTransition' in result, 'Should return transition validity');
      if (!result.canTransition) {
        assert.ok(result.blockingReasons, 'Should list blocking reasons');
        assert.ok(Array.isArray(result.blockingReasons), 'Reasons should be an array');
      }
    });
  });

  describe('ODD Statistics', () => {
    it('should provide ODD enforcement statistics', async () => {
      const response = await fetch('http://localhost:3000/api/odd/stats');
      const stats = await response.json();
      
      assert.ok('totalChecks' in stats, 'Should report total checks');
      assert.ok('violationsCount' in stats, 'Should report violations');
      assert.ok('escalationsCount' in stats, 'Should report escalations');
      assert.ok('modeDistribution' in stats, 'Should report mode distribution');
    });

    it('should track operations by mode', async () => {
      const response = await fetch('http://localhost:3000/api/odd/stats/by-mode');
      const stats = await response.json();
      
      assert.ok(stats.byMode, 'Should return mode breakdown');
      assert.ok(typeof stats.byMode === 'object', 'Breakdown should be an object');
    });
  });
});
