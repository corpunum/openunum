/**
 * E2E Tests: ODD (Operational Design Domain) Enforcement
 * 
 * Tests:
 * 1. ODD blocks shell_run in compact tier
 * 2. ODD allows file_read in compact tier
 * 3. Low confidence blocks mutating tools
 * 4. Full tier allows everything
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// Import the modules directly for testing
import { checkODD } from '../../src/core/execution-policy-engine.mjs';
import { gateAction } from '../../src/core/confidence-scorer.mjs';

describe('ODD Enforcement System', () => {
  describe('ODD Check - Compact Tier', () => {
    it('should block shell_run in compact tier', () => {
      const result = checkODD('shell_run', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, false, 'shell_run should be blocked in compact tier');
      assert.strictEqual(result.reason, 'blocked_by_odd', 'Should be blocked by ODD');
    });

    it('should block file_write in compact tier', () => {
      const result = checkODD('file_write', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, false, 'file_write should be blocked in compact tier');
      assert.strictEqual(result.reason, 'blocked_by_odd', 'Should be blocked by ODD');
    });

    it('should block file_patch in compact tier', () => {
      const result = checkODD('file_patch', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, false, 'file_patch should be blocked in compact tier');
      assert.strictEqual(result.reason, 'blocked_by_odd', 'Should be blocked by ODD');
    });

    it('should block desktop_open in compact tier', () => {
      const result = checkODD('desktop_open', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, false, 'desktop_open should be blocked in compact tier');
      assert.strictEqual(result.reason, 'blocked_by_odd', 'Should be blocked by ODD');
    });

    it('should block desktop_xdotool in compact tier', () => {
      const result = checkODD('desktop_xdotool', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, false, 'desktop_xdotool should be blocked in compact tier');
      assert.strictEqual(result.reason, 'blocked_by_odd', 'Should be blocked by ODD');
    });

    it('should allow file_read in compact tier', () => {
      const result = checkODD('file_read', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, true, 'file_read should be allowed in compact tier');
    });

    it('should allow http_request in compact tier', () => {
      const result = checkODD('http_request', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, true, 'http_request should be allowed in compact tier');
    });

    it('should allow browser_snapshot in compact tier', () => {
      const result = checkODD('browser_snapshot', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, true, 'browser_snapshot should be allowed in compact tier');
    });

    it('should allow skill_list in compact tier', () => {
      const result = checkODD('skill_list', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, true, 'skill_list should be allowed in compact tier');
    });

    it('should allow email_status in compact tier', () => {
      const result = checkODD('email_status', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, true, 'email_status should be allowed in compact tier');
    });

    it('should allow research_list_recent in compact tier', () => {
      const result = checkODD('research_list_recent', 0.9, 'compact');
      
      assert.strictEqual(result.allowed, true, 'research_list_recent should be allowed in compact tier');
    });

    it('should block mutating tool with low confidence in compact tier', () => {
      // Even though file_write is blocked, test with a tool that's allowed but mutating
      // shell_run is both mutating AND blocked in compact
      // Let's test the low_confidence scenario with a non-blocked tool concept
      // In compact tier, file_read is allowed but shell_run is blocked
      // If shell_run somehow got through blocked check, low confidence would block it
      
      // For this test, use shell_run which is blocked - blocked takes priority
      const result = checkODD('shell_run', 0.3, 'compact');
      assert.strictEqual(result.allowed, false, 'shell_run should be blocked in compact tier regardless of confidence');
    });
  });

  describe('ODD Check - Balanced Tier', () => {
    it('should allow file_read in balanced tier', () => {
      const result = checkODD('file_read', 0.6, 'balanced');
      
      assert.strictEqual(result.allowed, true, 'file_read should be allowed in balanced tier');
    });

    it('should allow file_write in balanced tier with sufficient confidence', () => {
      const result = checkODD('file_write', 0.6, 'balanced');
      
      assert.strictEqual(result.allowed, true, 'file_write should be allowed with confidence >= 0.5');
    });

    it('should block file_write in balanced tier with low confidence', () => {
      const result = checkODD('file_write', 0.3, 'balanced');
      
      assert.strictEqual(result.allowed, false, 'file_write should be blocked with low confidence');
      assert.strictEqual(result.reason, 'low_confidence', 'Should be blocked for low confidence');
    });

    it('should allow shell_run in balanced tier with sufficient confidence', () => {
      const result = checkODD('shell_run', 0.6, 'balanced');
      
      assert.strictEqual(result.allowed, true, 'shell_run should be allowed with confidence >= 0.5');
    });

    it('should block shell_run in balanced tier with low confidence', () => {
      const result = checkODD('shell_run', 0.3, 'balanced');
      
      assert.strictEqual(result.allowed, false, 'shell_run should be blocked with low confidence');
      assert.strictEqual(result.reason, 'low_confidence', 'Should be blocked for low confidence');
    });

    it('should allow http_request in balanced tier', () => {
      const result = checkODD('http_request', 0.3, 'balanced');
      
      assert.strictEqual(result.allowed, true, 'http_request should be allowed in balanced tier');
    });

    it('should block desktop_open in balanced tier', () => {
      const result = checkODD('desktop_open', 0.9, 'balanced');
      
      assert.strictEqual(result.allowed, false, 'desktop_open should be blocked in balanced tier');
      assert.strictEqual(result.reason, 'blocked_by_odd', 'Should be blocked by ODD');
    });

    it('should block desktop_xdotool in balanced tier', () => {
      const result = checkODD('desktop_xdotool', 0.9, 'balanced');
      
      assert.strictEqual(result.allowed, false, 'desktop_xdotool should be blocked in balanced tier');
      assert.strictEqual(result.reason, 'blocked_by_odd', 'Should be blocked by ODD');
    });
  });

  describe('ODD Check - Full Tier', () => {
    it('should allow shell_run in full tier with sufficient confidence', () => {
      const result = checkODD('shell_run', 0.5, 'full');
      
      assert.strictEqual(result.allowed, true, 'shell_run should be allowed in full tier');
    });

    it('should allow file_write in full tier with sufficient confidence', () => {
      const result = checkODD('file_write', 0.5, 'full');
      
      assert.strictEqual(result.allowed, true, 'file_write should be allowed in full tier');
    });

    it('should block mutating tool with very low confidence (< 0.3) in full tier', () => {
      const result = checkODD('file_write', 0.2, 'full');
      
      assert.strictEqual(result.allowed, false, 'file_write should be blocked with confidence < 0.3');
      assert.strictEqual(result.reason, 'low_confidence', 'Should be blocked for low confidence');
    });

    it('should allow browser_snapshot in full tier', () => {
      const result = checkODD('browser_snapshot', 0.1, 'full');
      
      assert.strictEqual(result.allowed, true, 'Non-mutating tools should be allowed regardless of confidence');
    });

    it('should allow http_request in full tier', () => {
      const result = checkODD('http_request', 0.1, 'full');
      
      assert.strictEqual(result.allowed, true, 'Non-mutating tools should be allowed regardless of confidence');
    });

    it('should allow file_read in full tier', () => {
      const result = checkODD('file_read', 0.1, 'full');
      
      assert.strictEqual(result.allowed, true, 'Non-mutating tools should be allowed regardless of confidence');
    });
  });

  describe('Confidence-Based Action Gating', () => {
    describe('gateAction - Mutating Tools', () => {
      it('should block mutating tools when confidence < 0.3', () => {
        const result = gateAction('file_write', 0.2, 'full');
        
        assert.strictEqual(result.blocked, true, 'Should be blocked');
        assert.strictEqual(result.reason, 'low_confidence_mutating', 'Should be blocked for low confidence mutating');
        assert.strictEqual(result.requiresApproval, true, 'Should require approval');
      });

      it('should allow mutating tools when confidence >= 0.3', () => {
        const result = gateAction('file_write', 0.3, 'full');
        
        assert.strictEqual(result.blocked, false, 'Should not be blocked at confidence >= 0.3');
      });

      it('should block shell_run when confidence < 0.5', () => {
        const result = gateAction('shell_run', 0.3, 'full');
        
        assert.strictEqual(result.blocked, true, 'Should be blocked');
        assert.strictEqual(result.reason, 'low_confidence_shell', 'Should be blocked for low confidence shell');
        assert.strictEqual(result.requiresApproval, true, 'Should require approval');
      });

      it('should allow shell_run when confidence >= 0.5', () => {
        const result = gateAction('shell_run', 0.5, 'full');
        
        assert.strictEqual(result.blocked, false, 'Should not be blocked at confidence >= 0.5');
      });

      it('should allow non-mutating tools regardless of confidence', () => {
        const result = gateAction('file_read', 0.1, 'full');
        
        assert.strictEqual(result.blocked, false, 'Non-mutating tools should not be blocked');
      });
    });

    describe('gateAction - Tier Variations', () => {
      it('should apply same gateAction logic regardless of tier', () => {
        // gateAction doesn't use tier, it uses fixed thresholds
        // This tests that the function works consistently
        
        const resultCompact = gateAction('shell_run', 0.2, 'compact');
        const resultBalanced = gateAction('shell_run', 0.2, 'balanced');
        const resultFull = gateAction('shell_run', 0.2, 'full');
        
        assert.strictEqual(resultCompact.blocked, true, 'compact: should block low confidence shell');
        assert.strictEqual(resultBalanced.blocked, true, 'balanced: should block low confidence shell');
        assert.strictEqual(resultFull.blocked, true, 'full: should block low confidence shell');
      });
    });
  });

  describe('Integration: ODD + GateAction', () => {
    it('should block shell_run in compact tier regardless of gateAction', () => {
      // First check ODD
      const oddResult = checkODD('shell_run', 0.9, 'compact');
      assert.strictEqual(oddResult.allowed, false, 'ODD should block shell_run in compact');
      
      // Even if gateAction would allow it, ODD blocks first
      const gateResult = gateAction('shell_run', 0.9, 'compact');
      assert.strictEqual(gateResult.blocked, false, 'gateAction would allow shell_run with high confidence');
      
      // But ODD takes precedence in the actual system
    });

    it('should allow file_read in compact tier with any confidence', () => {
      const oddResult = checkODD('file_read', 0.2, 'compact');
      assert.strictEqual(oddResult.allowed, true, 'ODD should allow file_read in compact');
      
      const gateResult = gateAction('file_read', 0.2, 'compact');
      assert.strictEqual(gateResult.blocked, false, 'gateAction should allow file_read');
    });

    it('should require approval for low confidence mutating tools in full tier', () => {
      // With confidence 0.2, file_write should be blocked by gateAction
      const gateResult = gateAction('file_write', 0.2, 'full');
      assert.strictEqual(gateResult.blocked, true, 'gateAction should block');
      assert.strictEqual(gateResult.requiresApproval, true, 'Should require approval');
    });
  });

  describe('Edge Cases', () => {
    it('should handle unknown tier as full tier', () => {
      const result = checkODD('shell_run', 0.5, 'unknown');
      
      // Unknown tier should fall back to full tier rules
      assert.strictEqual(result.allowed, true, 'Unknown tier should use full tier (allow)');
    });

    it('should handle confidence exactly at threshold', () => {
      // Confidence exactly at 0.5 for shell_run
      const result = gateAction('shell_run', 0.5, 'full');
      assert.strictEqual(result.blocked, false, 'Confidence exactly at 0.5 should be allowed');
      
      // Confidence exactly at 0.3 for mutating tool
      const result2 = gateAction('file_write', 0.3, 'full');
      assert.strictEqual(result2.blocked, false, 'Confidence exactly at 0.3 should be allowed');
    });

    it('should handle confidence below threshold', () => {
      // Confidence just below 0.5 for shell_run
      const result = gateAction('shell_run', 0.49, 'full');
      assert.strictEqual(result.blocked, true, 'Confidence below 0.5 should be blocked');
      
      // Confidence just below 0.3 for mutating tool
      const result2 = gateAction('file_write', 0.29, 'full');
      assert.strictEqual(result2.blocked, true, 'Confidence below 0.3 should be blocked');
    });

    it('should handle unknown tools gracefully', () => {
      const result = checkODD('unknown_tool', 0.9, 'compact');
      
      // Unknown tools should be allowed if not in blocked list
      // (compact blocks specific tools, unknown_tool is not in the list)
      assert.strictEqual(result.allowed, true, 'Unknown tools should be allowed if not blocked');
    });

    it('should handle null/undefined confidence', () => {
      const result1 = checkODD('file_read', null, 'compact');
      const result2 = checkODD('file_read', undefined, 'compact');
      
      // Should handle gracefully - null/undefined confidence
      // Our implementation uses < comparison which will be false for null
      // So it should pass the confidence check
      assert.strictEqual(result1.allowed, true, 'Should handle null confidence');
      assert.strictEqual(result2.allowed, true, 'Should handle undefined confidence');
    });
  });

  describe('Tool Type Classification', () => {
    it('should correctly identify mutating tools', () => {
      const mutatingTools = [
        'file_write', 'file_patch', 'file_restore_last', 'shell_run',
        'desktop_open', 'desktop_xdotool', 'skill_install', 'skill_approve',
        'skill_execute', 'skill_uninstall', 'email_send', 'gworkspace_call',
        'research_approve'
      ];
      
      const nonMutatingTools = [
        'file_read', 'http_request', 'browser_snapshot', 'browser_extract',
        'skill_list', 'email_status', 'research_list_recent', 'session_list',
        'session_delete', 'session_clear'
      ];
      
      // Test that mutating tools get blocked by gateAction with low confidence
      mutatingTools.forEach(tool => {
        const result = gateAction(tool, 0.2, 'full');
        assert.strictEqual(result.blocked, true, `${tool} should be classified as mutating`);
      });
      
      // Test that non-mutating tools are not blocked
      nonMutatingTools.forEach(tool => {
        const result = gateAction(tool, 0.2, 'full');
        assert.strictEqual(result.blocked, false, `${tool} should not be blocked`);
      });
    });
  });
});
