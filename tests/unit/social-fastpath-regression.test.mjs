import { describe, it, expect, beforeEach } from 'vitest';
import { FastPathRouter } from '../../src/core/fast-path-router.mjs';
import { FastAwarenessRouter } from '../../src/core/fast-awareness-router.mjs';
import { scoreDeterministicFastTurn } from '../../src/core/agent-helpers.mjs';

describe('Social Fast-Path Regression', () => {
  describe('agent-helpers: scoreDeterministicFastTurn', () => {
    it('should give high score to "how smart are you on a scale from 1-10?"', () => {
      const score = scoreDeterministicFastTurn('how smart are you on a scale from 1-10?');
      expect(score).toBeGreaterThanOrEqual(0.9);
    });

    it('should give high score to "what can you do?"', () => {
      const score = scoreDeterministicFastTurn('what can you do?');
      expect(score).toBeGreaterThanOrEqual(0.9);
    });

    it('should give high score to "who are you?"', () => {
      const score = scoreDeterministicFastTurn('who are you?');
      expect(score).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('FastPathRouter', () => {
    let router;
    const mockAgent = {
      getCurrentModel: () => ({ provider: 'ollama-cloud', model: 'qwen3.5:397b-cloud' })
    };
    const mockMemoryStore = {
      addMessage: () => {}
    };
    const mockConfig = {
      model: {
        provider: 'ollama-cloud',
        model: 'qwen3.5:397b-cloud'
      }
    };

    beforeEach(() => {
      router = new FastPathRouter({
        agent: mockAgent,
        memoryStore: mockMemoryStore,
        config: mockConfig
      });
    });

    it('should route "how smart are you on a scale from 1-10?"', async () => {
      const result = await router.route({
        message: 'how smart are you on a scale from 1-10?',
        sessionId: 'test',
        recentMessages: [],
        modelForBudget: mockAgent.getCurrentModel()
      });
      expect(result).not.toBeNull();
      expect(result.trace.fastPathCategory).toBe('self_assessment');
      expect(result.reply).toContain('autonomous AI agent');
    });

    it('should route "what can you do?"', async () => {
      const result = await router.route({
        message: 'what can you do?',
        sessionId: 'test',
        recentMessages: [],
        modelForBudget: mockAgent.getCurrentModel()
      });
      expect(result).not.toBeNull();
      expect(result.trace.fastPathCategory).toBe('self_assessment');
    });
  });

  describe('FastAwarenessRouter', () => {
    let router;

    beforeEach(() => {
      router = new FastAwarenessRouter({ enabled: true });
    });

    it('should classify "how smart are you on a scale from 1-10?" as light-chat with short-circuit', () => {
      const result = router.classify('how smart are you on a scale from 1-10?');
      expect(result.category).toBe('light-chat');
      expect(result.shouldShortCircuit).toBe(true);
    });
  });
});
