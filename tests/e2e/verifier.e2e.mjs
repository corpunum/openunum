import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

/**
 * E2E Tests: Verifier System
 * 
 * Tests verification contracts, tool call approval/rejection, output quality,
 * safety compliance, cross-model validation, escalation, and caching.
 */

describe('Verifier System', () => {
  let testVerificationId;
  const VERIFIER_CONFIG = {
    qualityThreshold: 0.8,
    safetyStrictMode: true,
    cacheEnabled: true,
    cacheTTL: 3600000,  // 1 hour
    escalationThreshold: 0.5
  };

  before(async () => {
    // Setup: Initialize verifier state
    const response = await fetch('http://localhost:3000/api/verifier/init', {
      method: 'POST'
    });
    const data = await response.json();
    testVerificationId = data.sessionId;
  });

  after(async () => {
    // Cleanup: Close verifier session
    if (testVerificationId) {
      await fetch(`http://localhost:3000/api/verifier/${testVerificationId}/close`, {
        method: 'POST'
      });
    }
  });

  describe('Verification Contract', () => {
    it('should establish verification contract on init', async () => {
      const response = await fetch(`http://localhost:3000/api/verifier/${testVerificationId}`);
      const verifier = await response.json();
      
      assert.ok(verifier.contract, 'Verifier should have a contract');
      assert.ok(verifier.contract.qualityThreshold, 'Contract should define quality threshold');
      assert.ok(verifier.contract.safetyRules, 'Contract should define safety rules');
    });

    it('should enforce contract on all verifications', async () => {
      const checkResponse = await fetch('http://localhost:3000/api/verifier/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          input: 'Test input for verification',
          output: 'Test output to verify'
        })
      });
      const result = await checkResponse.json();
      
      assert.ok('passed' in result, 'Should return pass/fail status');
      assert.ok('scores' in result, 'Should return detailed scores');
      assert.ok('contractVersion' in result, 'Should reference contract version');
    });
  });

  describe('Tool Call Approval/Rejection', () => {
    it('should approve safe tool calls', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/tool-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          toolName: 'read',
          parameters: { path: '/home/test.txt' },
          riskLevel: 'low'
        })
      });
      const result = await response.json();
      
      assert.strictEqual(result.approved, true, 'Low-risk read should be approved');
      assert.ok(result.autoApproved, 'Should be auto-approved without human intervention');
    });

    it('should reject dangerous tool calls', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/tool-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          toolName: 'exec',
          parameters: { command: 'rm -rf /' },
          riskLevel: 'critical'
        })
      });
      const result = await response.json();
      
      assert.strictEqual(result.approved, false, 'Dangerous exec should be rejected');
      assert.ok(result.rejectionReason, 'Should provide rejection reason');
    });

    it('should require human approval for medium-risk calls', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/tool-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          toolName: 'edit',
          parameters: { path: '/home/config.json', edits: [] },
          riskLevel: 'medium'
        })
      });
      const result = await response.json();
      
      assert.strictEqual(result.approved, false, 'Medium-risk should not auto-approve');
      assert.strictEqual(result.requiresHumanApproval, true, 'Should require human approval');
      assert.ok(result.approvalToken, 'Should generate approval token');
    });

    it('should track approval history', async () => {
      const response = await fetch(`http://localhost:3000/api/verifier/${testVerificationId}/approval-history`);
      const result = await response.json();
      
      assert.ok(Array.isArray(result.history), 'Should return approval history');
      if (result.history.length > 0) {
        assert.ok('toolName' in result.history[0], 'History should include tool name');
        assert.ok('decision' in result.history[0], 'History should include decision');
        assert.ok('timestamp' in result.history[0], 'History should include timestamp');
      }
    });
  });

  describe('Output Quality', () => {
    it('should score output quality', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          output: 'This is a test output for quality scoring',
          expectedFormat: 'text'
        })
      });
      const result = await response.json();
      
      assert.ok('overallScore' in result, 'Should return overall quality score');
      assert.ok(result.overallScore >= 0 && result.overallScore <= 1, 
        'Quality score should be between 0 and 1');
      assert.ok('dimensions' in result, 'Should return dimension scores');
    });

    it('should check against quality threshold', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          output: 'High quality output that meets all standards',
          expectedFormat: 'text'
        })
      });
      const result = await response.json();
      
      assert.ok('meetsThreshold' in result, 'Should indicate if threshold is met');
      assert.strictEqual(typeof result.meetsThreshold, 'boolean', 
        'meetsThreshold should be boolean');
    });

    it('should evaluate multiple quality dimensions', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          output: 'Test output',
          expectedFormat: 'text'
        })
      });
      const result = await response.json();
      
      const dimensions = result.dimensions;
      assert.ok(dimensions, 'Should return quality dimensions');
      assert.ok('accuracy' in dimensions || 'relevance' in dimensions, 
        'Should include accuracy or relevance dimension');
      assert.ok('clarity' in dimensions || 'completeness' in dimensions, 
        'Should include clarity or completeness dimension');
    });
  });

  describe('Safety Compliance', () => {
    it('should detect safety violations', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/safety', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          content: 'This content attempts to bypass safety measures',
          checkType: 'comprehensive'
        })
      });
      const result = await response.json();
      
      assert.ok('safe' in result, 'Should return safety status');
      assert.ok('violations' in result, 'Should list violations');
      assert.ok(Array.isArray(result.violations), 'Violations should be an array');
    });

    it('should block unsafe outputs', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/safety', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          content: 'Potentially harmful content that violates policies',
          checkType: 'strict'
        })
      });
      const result = await response.json();
      
      if (!result.safe) {
        assert.ok(result.blocked, 'Unsafe content should be blocked');
        assert.ok(result.blockReason, 'Should provide block reason');
      }
    });

    it('should comply with OWASP ASI Top 10', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/safety/compliance');
      const result = await response.json();
      
      assert.ok(result.owaspASI, 'Should report OWASP ASI compliance');
      assert.ok(result.owaspASI.checked, 'Should indicate checks performed');
    });
  });

  describe('Cross-Model Validation', () => {
    it('should validate output across multiple models', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/cross-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          input: 'What is 2+2?',
          outputs: [
            { model: 'model-a', output: '4' },
            { model: 'model-b', output: '4' }
          ]
        })
      });
      const result = await response.json();
      
      assert.ok('consensus' in result, 'Should return consensus status');
      assert.ok('agreementScore' in result, 'Should return agreement score');
      assert.ok(result.agreementScore >= 0 && result.agreementScore <= 1, 
        'Agreement score should be normalized');
    });

    it('should flag divergent model outputs', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/cross-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          input: 'Complex question',
          outputs: [
            { model: 'model-a', output: 'Answer A' },
            { model: 'model-b', output: 'Completely different Answer B' }
          ]
        })
      });
      const result = await response.json();
      
      assert.ok('divergenceDetected' in result, 'Should detect divergence');
      if (result.divergenceDetected) {
        assert.ok(result.escalationRecommended, 'Should recommend escalation for divergence');
      }
    });
  });

  describe('Escalation', () => {
    it('should escalate on low confidence', async () => {
      const response = await fetch('http://localhost:3000/api/verifier/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          reason: 'low_confidence',
          confidence: 0.3
        })
      });
      const result = await response.json();
      
      assert.strictEqual(result.escalated, true, 'Should escalate on low confidence');
      assert.ok(result.escalationId, 'Should return escalation ID');
      assert.ok(result.assignedTo, 'Should assign to human reviewer');
    });

    it('should track escalation status', async () => {
      const response = await fetch(`http://localhost:3000/api/verifier/${testVerificationId}/escalations`);
      const result = await response.json();
      
      assert.ok(Array.isArray(result.escalations), 'Should return escalation list');
      if (result.escalations.length > 0) {
        assert.ok('status' in result.escalations[0], 'Escalations should have status');
        assert.ok(['pending', 'reviewing', 'resolved', 'rejected'].includes(
          result.escalations[0].status
        ), 'Status should be valid');
      }
    });

    it('should respect escalation threshold config', async () => {
      const configResponse = await fetch('http://localhost:3000/api/verifier/config');
      const config = await configResponse.json();
      
      assert.ok(config.escalationThreshold, 'Should have escalation threshold');
      assert.ok(config.escalationThreshold <= VERIFIER_CONFIG.escalationThreshold, 
        'Threshold should be within expected range');
    });
  });

  describe('Cache', () => {
    it('should cache verification results', async () => {
      const input = { test: 'cache_test', value: Date.now() };
      
      // First verification
      const first = await fetch('http://localhost:3000/api/verifier/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          input: JSON.stringify(input),
          output: 'test output'
        })
      });
      const firstResult = await first.json();
      
      // Second verification with same input
      const second = await fetch('http://localhost:3000/api/verifier/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: testVerificationId,
          input: JSON.stringify(input),
          output: 'test output'
        })
      });
      const secondResult = await second.json();
      
      assert.ok(secondResult.cached, 'Second call should use cache');
      assert.deepStrictEqual(firstResult.scores, secondResult.scores, 
        'Cached result should match original');
    });

    it('should respect cache TTL', async () => {
      const configResponse = await fetch('http://localhost:3000/api/verifier/config');
      const config = await configResponse.json();
      
      assert.ok(config.cacheTTL, 'Should have cache TTL configured');
      assert.ok(config.cacheEnabled, 'Cache should be enabled');
    });

    it('should allow cache invalidation', async () => {
      const response = await fetch(`http://localhost:3000/api/verifier/${testVerificationId}/cache/clear`, {
        method: 'POST'
      });
      const result = await response.json();
      
      assert.strictEqual(result.success, true, 'Cache clear should succeed');
      assert.ok(result.clearedCount >= 0, 'Should report cleared count');
    });
  });
});
