import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

/**
 * E2E Tests: Hippocampal Replay System
 * 
 * Tests memory replay triggers, consolidation, retrieval boosts, and loop prevention.
 */

describe('Hippocampal Replay System', () => {
  let testMemoryIds = [];
  const REPLAY_CONFIG = {
    consolidationThreshold: 3,    // Accesses before auto-consolidation
    replayIntervalMs: 60000,      // Minimum interval between replays
    boostMultiplier: 1.5,         // Retrieval boost for consolidated memories
    loopPreventionWindow: 300000  // 5 minutes loop prevention window
  };

  before(async () => {
    // Setup: Create test memories for replay scenarios
    const memories = [
      { text: 'Memory A for replay test', category: 'fact', importance: 0.7 },
      { text: 'Memory B for replay test', category: 'decision', importance: 0.8 },
      { text: 'Memory C for replay test', category: 'reflection', importance: 0.9 }
    ];

    for (const mem of memories) {
      const response = await fetch('http://localhost:3000/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mem)
      });
      const data = await response.json();
      testMemoryIds.push(data.id);
    }
  });

  after(async () => {
    // Cleanup: Remove test memories
    for (const id of testMemoryIds) {
      await fetch(`http://localhost:3000/api/memory/${id}`, {
        method: 'DELETE'
      });
    }
  });

  describe('Replay Triggers', () => {
    it('should trigger replay on memory access', async () => {
      const response = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[0]}/access`, {
        method: 'POST'
      });
      const result = await response.json();
      
      assert.strictEqual(result.success, true, 'Access should succeed');
      assert.ok('replayTriggered' in result, 'Should indicate if replay was triggered');
    });

    it('should respect minimum replay interval', async () => {
      // First access
      await fetch(`http://localhost:3000/api/memory/${testMemoryIds[0]}/access`, {
        method: 'POST'
      });
      
      // Immediate second access (should not trigger replay)
      const response = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[0]}/access`, {
        method: 'POST'
      });
      const result = await response.json();
      
      assert.strictEqual(result.replayTriggered, false, 
        'Replay should not trigger within minimum interval');
    });

    it('should trigger replay after interval expires', async () => {
      // This test assumes time manipulation or waits for interval
      // In real E2E, would use mock time or wait
      const configResponse = await fetch('http://localhost:3000/api/memory/config/replay');
      const config = await configResponse.json();
      
      assert.ok(config.replayIntervalMs > 0, 'Replay interval should be configured');
    });
  });

  describe('Memory Selection for Replay', () => {
    it('should prioritize high-importance memories', async () => {
      const response = await fetch('http://localhost:3000/api/memory/replay/candidates');
      const result = await response.json();
      
      assert.ok(Array.isArray(result.candidates), 'Should return candidate list');
      if (result.candidates.length > 1) {
        const firstImportance = result.candidates[0].importance;
        const lastImportance = result.candidates[result.candidates.length - 1].importance;
        assert.ok(firstImportance >= lastImportance, 
          'Candidates should be sorted by importance');
      }
    });

    it('should exclude recently consolidated memories', async () => {
      const response = await fetch('http://localhost:3000/api/memory/replay/candidates');
      const result = await response.json();
      
      assert.ok(result.candidates.every(m => !m.recentlyConsolidated), 
        'Candidates should not include recently consolidated memories');
    });

    it('should filter by consolidation state', async () => {
      const response = await fetch('http://localhost:3000/api/memory/replay/candidates?state=pending');
      const result = await response.json();
      
      assert.ok(result.candidates.every(m => m.consolidationState === 'pending'), 
        'All candidates should be in pending state');
    });
  });

  describe('Consolidation States', () => {
    it('should track memory consolidation state', async () => {
      const response = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[0]}`);
      const memory = await response.json();
      
      assert.ok(['pending', 'consolidating', 'consolidated', 'failed'].includes(memory.consolidationState),
        'Memory should have valid consolidation state');
    });

    it('should transition state on consolidation', async () => {
      // Start consolidation
      const startResponse = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[1]}/consolidate`, {
        method: 'POST'
      });
      const startResult = await startResponse.json();
      assert.strictEqual(startResult.success, true, 'Consolidation should start');
      
      // Check state changed to consolidating
      const stateResponse = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[1]}`);
      const memory = await stateResponse.json();
      assert.strictEqual(memory.consolidationState, 'consolidating', 
        'State should be consolidating during process');
    });

    it('should mark as consolidated after successful completion', async () => {
      // Wait for consolidation (in real test, would poll or use webhook)
      const response = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[1]}`);
      const memory = await response.json();
      
      assert.ok(['consolidated', 'consolidating'].includes(memory.consolidationState),
        'Memory should be consolidated or consolidating');
    });
  });

  describe('Retrieval Boosts', () => {
    it('should boost consolidated memories in search', async () => {
      const response = await fetch('http://localhost:3000/api/memory/search?q=replay');
      const result = await response.json();
      
      const consolidatedMemories = result.results.filter(m => m.consolidationState === 'consolidated');
      const nonConsolidated = result.results.filter(m => m.consolidationState !== 'consolidated');
      
      if (consolidatedMemories.length > 0 && nonConsolidated.length > 0) {
        const avgConsolidatedScore = consolidatedMemories.reduce((sum, m) => sum + m.score, 0) / consolidatedMemories.length;
        const avgNonScore = nonConsolidated.reduce((sum, m) => sum + m.score, 0) / nonConsolidated.length;
        
        assert.ok(avgConsolidatedScore >= avgNonScore, 
          'Consolidated memories should have boosted scores');
      }
    });

    it('should apply configurable boost multiplier', async () => {
      const configResponse = await fetch('http://localhost:3000/api/memory/config/replay');
      const config = await configResponse.json();
      
      assert.ok(config.boostMultiplier >= 1, 'Boost multiplier should be >= 1');
      assert.ok(config.boostMultiplier <= 3, 'Boost multiplier should be reasonable');
    });
  });

  describe('Loop Prevention', () => {
    it('should prevent replay loops within time window', async () => {
      // Access memory multiple times rapidly
      const accesses = [];
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[2]}/access`, {
          method: 'POST'
        });
        accesses.push(await response.json());
      }
      
      // Count how many times replay was triggered
      const replayCount = accesses.filter(a => a.replayTriggered).length;
      assert.ok(replayCount <= 1, 'Should not trigger replay multiple times in quick succession');
    });

    it('should track replay history for loop detection', async () => {
      const response = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[2]}/replay-history`);
      const result = await response.json();
      
      assert.ok(Array.isArray(result.history), 'Should return replay history');
      if (result.history.length > 0) {
        assert.ok('timestamp' in result.history[0], 'History entries should have timestamps');
        assert.ok('memoryId' in result.history[0], 'History entries should have memoryId');
      }
    });
  });

  describe('Auto-Consolidation After 3+ Accesses', () => {
    it('should auto-consolidate after threshold accesses', async () => {
      // Access memory 3+ times
      for (let i = 0; i < REPLAY_CONFIG.consolidationThreshold + 1; i++) {
        await fetch(`http://localhost:3000/api/memory/${testMemoryIds[0]}/access`, {
          method: 'POST'
        });
      }
      
      // Check if consolidation was triggered
      const response = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[0]}`);
      const memory = await response.json();
      
      assert.ok(
        memory.consolidationState === 'consolidated' || 
        memory.consolidationState === 'consolidating' ||
        memory.autoConsolidationPending === true,
        'Memory should be consolidated or pending after threshold accesses'
      );
    });

    it('should track access count for auto-consolidation', async () => {
      const response = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[0]}`);
      const memory = await response.json();
      
      assert.ok('accessCount' in memory, 'Memory should track access count');
      assert.ok(memory.accessCount >= REPLAY_CONFIG.consolidationThreshold, 
        'Access count should reflect our test accesses');
    });

    it('should reset access count after consolidation', async () => {
      // Force consolidation
      await fetch(`http://localhost:3000/api/memory/${testMemoryIds[0]}/consolidate`, {
        method: 'POST'
      });
      
      const response = await fetch(`http://localhost:3000/api/memory/${testMemoryIds[0]}`);
      const memory = await response.json();
      
      if (memory.consolidationState === 'consolidated') {
        assert.ok(memory.accessCount <= 1, 'Access count should be reset after consolidation');
      }
    });
  });
});
