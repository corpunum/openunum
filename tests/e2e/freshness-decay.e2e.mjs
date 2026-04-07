import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

/**
 * E2E Tests: Freshness Decay System
 * 
 * Tests the memory freshness scoring, half-life decay, and staleness detection.
 */

describe('Freshness Decay System', () => {
  let testMemoryId;
  const HALF_LIFE_CONFIG = {
    conversation: 3600000,      // 1 hour
    fact: 86400000,             // 24 hours
    decision: 604800000,        // 7 days
    preference: 2592000000,     // 30 days
    reflection: 7776000000      // 90 days
  };

  before(async () => {
    // Setup: Create test memories with known timestamps
    const response = await fetch('http://localhost:3000/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Test memory for freshness decay',
        category: 'fact',
        importance: 0.8
      })
    });
    const data = await response.json();
    testMemoryId = data.id;
  });

  after(async () => {
    // Cleanup: Remove test memories
    if (testMemoryId) {
      await fetch(`http://localhost:3000/api/memory/${testMemoryId}`, {
        method: 'DELETE'
      });
    }
  });

  describe('Half-life Configuration', () => {
    it('should have valid half-life values per category', async () => {
      const configResponse = await fetch('http://localhost:3000/api/memory/config/decay');
      const config = await configResponse.json();
      
      assert.ok(config.halfLife, 'Half-life config should exist');
      assert.ok(config.halfLife.conversation > 0, 'Conversation half-life should be positive');
      assert.ok(config.halfLife.fact > 0, 'Fact half-life should be positive');
      assert.ok(config.halfLife.decision > 0, 'Decision half-life should be positive');
      assert.ok(config.halfLife.preference > 0, 'Preference half-life should be positive');
      assert.ok(config.halfLife.reflection > 0, 'Reflection half-life should be positive');
    });

    it('should apply category-specific half-life to memories', async () => {
      const memoryResponse = await fetch(`http://localhost:3000/api/memory/${testMemoryId}`);
      const memory = await memoryResponse.json();
      
      assert.strictEqual(memory.category, 'fact', 'Memory should have correct category');
      assert.ok(memory.halfLifeMs === HALF_LIFE_CONFIG.fact, 'Should use fact half-life');
    });
  });

  describe('Decay Functions', () => {
    it('should calculate freshness score correctly', async () => {
      const now = Date.now();
      const age = now - HALF_LIFE_CONFIG.fact; // Exactly one half-life old
      
      const response = await fetch('http://localhost:3000/api/memory/freshness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memoryId: testMemoryId,
          timestamp: now - age
        })
      });
      const result = await response.json();
      
      assert.ok(result.freshnessScore >= 0 && result.freshnessScore <= 1, 
        'Freshness score should be between 0 and 1');
      assert.ok(Math.abs(result.freshnessScore - 0.5) < 0.01, 
        'After one half-life, freshness should be ~0.5');
    });

    it('should decay exponentially over time', async () => {
      const response = await fetch('http://localhost:3000/api/memory/freshness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memoryId: testMemoryId,
          timestamp: Date.now() - (HALF_LIFE_CONFIG.fact * 2) // Two half-lives
        })
      });
      const result = await response.json();
      
      assert.ok(Math.abs(result.freshnessScore - 0.25) < 0.01, 
        'After two half-lives, freshness should be ~0.25');
    });
  });

  describe('Staleness Detection', () => {
    it('should mark memory as stale after 3 half-lives', async () => {
      const threeHalfLives = HALF_LIFE_CONFIG.fact * 3;
      
      const response = await fetch('http://localhost:3000/api/memory/freshness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memoryId: testMemoryId,
          timestamp: Date.now() - threeHalfLives
        })
      });
      const result = await response.json();
      
      assert.strictEqual(result.isStale, true, 'Memory should be stale after 3 half-lives');
      assert.ok(result.freshnessScore < 0.125, 'Freshness should be below 12.5%');
    });

    it('should list stale memories via API', async () => {
      const response = await fetch('http://localhost:3000/api/memory/stale');
      const result = await response.json();
      
      assert.ok(Array.isArray(result.staleMemories), 'Should return array of stale memories');
      assert.ok(result.staleMemories.every(m => m.isStale === true), 
        'All returned memories should be stale');
    });
  });

  describe('Retrieval with Freshness Scoring', () => {
    it('should include freshness in retrieval results', async () => {
      const response = await fetch('http://localhost:3000/api/memory/search?q=test');
      const result = await response.json();
      
      assert.ok(result.results, 'Should return results');
      if (result.results.length > 0) {
        assert.ok('freshnessScore' in result.results[0], 
          'Each result should include freshnessScore');
      }
    });

    it('should boost recent memories in search results', async () => {
      const response = await fetch('http://localhost:3000/api/memory/search?q=test&boostFreshness=true');
      const result = await response.json();
      
      assert.ok(result.results, 'Should return results');
      // Verify that results are sorted by combined relevance + freshness
      if (result.results.length > 1) {
        const firstFreshness = result.results[0].freshnessScore || 0;
        const lastFreshness = result.results[result.results.length - 1].freshnessScore || 0;
        assert.ok(firstFreshness >= lastFreshness, 
          'Results should be sorted with fresher memories first when boost enabled');
      }
    });
  });

  describe('Refresh Endpoint', () => {
    it('should refresh a stale memory', async () => {
      const response = await fetch(`http://localhost:3000/api/memory/${testMemoryId}/refresh`, {
        method: 'POST'
      });
      const result = await response.json();
      
      assert.strictEqual(result.success, true, 'Refresh should succeed');
      assert.ok(result.freshnessScore > 0.9, 'Freshness should be reset to near 1.0');
      assert.strictEqual(result.isStale, false, 'Memory should no longer be stale');
    });

    it('should update lastAccessed timestamp on refresh', async () => {
      const beforeRefresh = await fetch(`http://localhost:3000/api/memory/${testMemoryId}`);
      const beforeData = await beforeRefresh.json();
      
      await fetch(`http://localhost:3000/api/memory/${testMemoryId}/refresh`, {
        method: 'POST'
      });
      
      const afterRefresh = await fetch(`http://localhost:3000/api/memory/${testMemoryId}`);
      const afterData = await afterRefresh.json();
      
      assert.ok(afterData.lastAccessed >= beforeData.lastAccessed, 
        'lastAccessed should be updated on refresh');
    });
  });
});
