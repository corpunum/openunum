/**
 * E2E Tests: Freshness Decay System (R5)
 * 
 * Direct module tests for memory freshness scoring and half-life decay.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { 
  calculateFreshness, 
  isStale, 
  getHalfLifeForCategory, 
  applyFreshnessDecay,
  getFreshnessMetadata,
  getHalfLifeConfig,
  getTimeUntilStale 
} from '../../src/memory/freshness-decay.mjs';

describe('Freshness Decay (R5)', () => {

  describe('calculateFreshness', () => {
    it('new memory has freshness ~1.0', () => {
      const freshness = calculateFreshness(Date.now(), 3600000); // 1h half-life
      assert.ok(freshness > 0.99, `Expected >0.99, got ${freshness}`);
      assert.ok(freshness <= 1.0, `Expected <=1.0, got ${freshness}`);
    });

    it('30-day-old memory with 30-day half-life has freshness ~0.5', () => {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const createdAt = Date.now() - thirtyDaysMs;
      const freshness = calculateFreshness(createdAt, thirtyDaysMs);
      assert.ok(Math.abs(freshness - 0.5) < 0.01, `Expected ~0.5, got ${freshness}`);
    });

    it('freshness halves every half-life', () => {
      const halfLife = 10000; // 10s
      const oneHalfLife = calculateFreshness(Date.now() - halfLife, halfLife);
      const twoHalfLives = calculateFreshness(Date.now() - 2 * halfLife, halfLife);
      assert.ok(Math.abs(oneHalfLife - 0.5) < 0.01, `1HL: expected ~0.5, got ${oneHalfLife}`);
      assert.ok(Math.abs(twoHalfLives - 0.25) < 0.01, `2HL: expected ~0.25, got ${twoHalfLives}`);
    });

    it('very old memory approaches zero', () => {
      const halfLife = 1000;
      const createdAt = Date.now() - 100 * halfLife; // 100 half-lives
      const freshness = calculateFreshness(createdAt, halfLife);
      assert.ok(freshness < 0.001, `Expected near-zero, got ${freshness}`);
    });

    it('handles edge cases', () => {
      assert.strictEqual(calculateFreshness(Date.now() + 1000, 3600000), 1.0); // future timestamp
      assert.strictEqual(calculateFreshness(Date.now(), 3600000), 1.0); // zero age
      assert.strictEqual(calculateFreshness(Date.now() - 1000, 0), 0.0); // zero half-life
    });
  });

  describe('getHalfLifeForCategory', () => {
    it('returns correct half-lives for each category', () => {
      assert.strictEqual(getHalfLifeForCategory('fact'), 168 * 60 * 60 * 1000);
      assert.strictEqual(getHalfLifeForCategory('strategy'), 72 * 60 * 60 * 1000);
      assert.strictEqual(getHalfLifeForCategory('skill'), 24 * 60 * 60 * 1000);
      assert.strictEqual(getHalfLifeForCategory('decision'), 96 * 60 * 60 * 1000);
      assert.strictEqual(getHalfLifeForCategory('preference'), 120 * 60 * 60 * 1000);
      assert.strictEqual(getHalfLifeForCategory('reflection'), 336 * 60 * 60 * 1000);
    });

    it('returns default for unknown categories', () => {
      assert.strictEqual(getHalfLifeForCategory('unknown'), 48 * 60 * 60 * 1000);
      assert.strictEqual(getHalfLifeForCategory(null), 48 * 60 * 60 * 1000);
      assert.strictEqual(getHalfLifeForCategory(''), 48 * 60 * 60 * 1000);
    });
  });

  describe('isStale', () => {
    it('detects stale memory after 3 half-lives', () => {
      const halfLife = 10000; // 10s half-life to avoid timing issues
      const createdAt = Date.now() - (3.1 * halfLife); // slightly more than 3 half-lives
      assert.strictEqual(isStale(createdAt, halfLife), true);
    });

    it('fresh memory is not stale', () => {
      const halfLife = 3600000;
      const createdAt = Date.now() - 1000; // 1 second ago
      assert.strictEqual(isStale(createdAt, halfLife), false);
    });

    it('supports custom threshold', () => {
      const halfLife = 1000;
      const createdAt = Date.now() - 2 * halfLife; // 2HL = 0.25 freshness
      assert.strictEqual(isStale(createdAt, halfLife, 0.5), true);
      assert.strictEqual(isStale(createdAt, halfLife, 0.2), false);
    });
  });

  describe('applyFreshnessDecay', () => {
    it('multiplies base score by freshness', () => {
      const halfLifeMs = 48 * 60 * 60 * 1000; // 'default' half-life = 48h
      const createdAt = Date.now() - halfLifeMs; // 1 half-life = 0.5 freshness
      const result = applyFreshnessDecay(100, createdAt, 'default');
      assert.ok(Math.abs(result - 50) < 1, `Expected ~50, got ${result}`);
    });

    it('fresh memory preserves score', () => {
      const result = applyFreshnessDecay(100, Date.now(), 'fact');
      assert.ok(Math.abs(result - 100) < 0.1, `Expected ~100, got ${result}`);
    });
  });

  describe('getFreshnessMetadata', () => {
    it('returns complete metadata', () => {
      const record = { createdAt: new Date(Date.now() - 1000).toISOString(), category: 'fact' };
      const meta = getFreshnessMetadata(record, 'fact');
      assert.ok(meta.freshness > 0, 'Should have freshness');
      assert.ok(meta.halfLifeMs > 0, 'Should have halfLifeMs');
      assert.ok(meta.ageMs > 0, 'Should have ageMs');
      assert.strictEqual(typeof meta.isStale, 'boolean', 'Should have isStale');
    });

    it('handles created_at field name', () => {
      const record = { created_at: new Date(Date.now() - 1000).toISOString() };
      const meta = getFreshnessMetadata(record, 'fact');
      assert.ok(meta.freshness > 0, 'Should handle created_at field');
    });
  });

  describe('getHalfLifeConfig', () => {
    it('returns all categories with hours', () => {
      const config = getHalfLifeConfig();
      assert.strictEqual(config.fact, 168);
      assert.strictEqual(config.strategy, 72);
      assert.strictEqual(config.skill, 24);
      assert.strictEqual(config.decision, 96);
      assert.strictEqual(config.preference, 120);
      assert.strictEqual(config.reflection, 336);
      assert.strictEqual(config.default, 48);
    });
  });

  describe('getTimeUntilStale', () => {
    it('returns positive value for fresh memory', () => {
      const halfLife = 3600000;
      const createdAt = Date.now() - 1000;
      const timeUntil = getTimeUntilStale(createdAt, halfLife);
      assert.ok(timeUntil > 0, `Expected positive, got ${timeUntil}`);
    });

    it('returns 0 for stale memory', () => {
      const halfLife = 1000;
      const createdAt = Date.now() - 10 * halfLife;
      const timeUntil = getTimeUntilStale(createdAt, halfLife);
      assert.strictEqual(timeUntil, 0);
    });
  });
});
