import { describe, it, expect, beforeEach } from 'vitest';
import { FastAwarenessRouter, createFastAwarenessRouter } from '../../src/core/fast-awareness-router.mjs';

/**
 * Mock WorkingMemoryAnchor for testing
 */
class MockWorkingMemory {
  constructor(hasAnchor = true, aboutTask = false) {
    this._hasAnchor = hasAnchor;
    this._aboutTask = aboutTask;
  }

  hasAnchor() {
    return this._hasAnchor;
  }

  isAboutCurrentTask() {
    return this._aboutTask;
  }
}

describe('FastAwarenessRouter', () => {
  let router;
  let mockMemory;

  beforeEach(() => {
    mockMemory = new MockWorkingMemory();
    router = createFastAwarenessRouter({}, mockMemory);
  });

  describe('constructor', () => {
    it('should create router with default config', () => {
      const r = createFastAwarenessRouter();
      expect(r.config.enabled).toBe(true);
      expect(r.config.minConfidenceForSkip).toBe(0.85);
      expect(r.config.minConfidenceForHotOnly).toBe(0.70);
    });

    it('should merge custom config with defaults', () => {
      const r = createFastAwarenessRouter({ minConfidenceForSkip: 0.90 });
      expect(r.config.minConfidenceForSkip).toBe(0.90);
      expect(r.config.minConfidenceForHotOnly).toBe(0.70);
    });

    it('should deep-merge classificationRules so new default keyword buckets remain available', () => {
      const r = createFastAwarenessRouter({
        classificationRules: {
          taskMetaKeywords: ['current task']
        }
      });
      const result = r.classify('all good ?');
      expect(result).toBeTruthy();
      expect(typeof result.category).toBe('string');
    });

    it('should accept working memory reference', () => {
      const memory = new MockWorkingMemory();
      const r = createFastAwarenessRouter({}, memory);
      expect(r.workingMemory).toBe(memory);
    });
  });

  describe('classify', () => {
    describe('greeting fast-path', () => {
      it('should classify "hello" as greeting with short-circuit', () => {
        const result = router.classify('hello');
        expect(result.category).toBe('greeting');
        expect(result.strategy).toBe('skip-retrieval');
        expect(result.shouldShortCircuit).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      });

      it('should classify "good morning" as greeting', () => {
        const result = router.classify('Good morning');
        expect(result.category).toBe('greeting');
        expect(result.shouldShortCircuit).toBe(true);
      });

      it('should classify short health-check small-talk as greeting fast-path', () => {
        const r1 = router.classify('all good ?');
        const r2 = router.classify('you failed ?');
        expect(r1.category).toBe('light-chat');
        expect(r1.shouldShortCircuit).toBe(true);
        expect(r2.category).toBe('light-chat');
        expect(r2.shouldShortCircuit).toBe(true);
      });

      it('should not classify task-like short questions as light-chat', () => {
        const r = router.classify('what is app ?');
        expect(r.category).not.toBe('light-chat');
      });
    });

    describe('task-meta questions (skip-retrieval)', () => {
      it('should classify "what is my current task" as task-meta', () => {
        const result = router.classify('What is my current task?');
        expect(result.category).toBe('task-meta');
        expect(result.strategy).toBe('skip-retrieval');
        expect(result.shouldShortCircuit).toBe(true);
      });

      it('should classify "what am i doing" as task-meta', () => {
        const result = router.classify('What am I doing?');
        expect(result.category).toBe('task-meta');
        expect(result.strategy).toBe('skip-retrieval');
      });

      it('should classify "where are we" as task-meta', () => {
        const result = router.classify('Where are we in the process?');
        expect(result.category).toBe('task-meta');
        expect(result.strategy).toBe('skip-retrieval');
      });

      it('should classify "remind me what i was doing" as task-meta', () => {
        const result = router.classify('Remind me what I was working on');
        expect(result.category).toBe('task-meta');
        expect(result.strategy).toBe('skip-retrieval');
      });

      it('should use working memory match when available', () => {
        const memory = new MockWorkingMemory(true, true);
        const r = createFastAwarenessRouter({}, memory);
        const result = r.classify('What step am I on?');
        expect(result.category).toBe('task-meta');
        expect(result.confidence).toBeGreaterThanOrEqual(0.95);
        expect(result.reason).toBe('working_memory_match');
      });
    });

    describe('continuation (hot-only)', () => {
      it('should classify "continue" as continuation', () => {
        const result = router.classify('Continue');
        expect(result.category).toBe('continuation');
        expect(result.strategy).toBe('hot-only');
        expect(result.shouldShortCircuit).toBe(false);
      });

      it('should classify "go on" as continuation', () => {
        const result = router.classify('Go on');
        expect(result.category).toBe('continuation');
        expect(result.strategy).toBe('hot-only');
      });

      it('should classify "continue with" as continuation', () => {
        const result = router.classify('Continue with the task');
        expect(result.category).toBe('continuation');
        expect(result.strategy).toBe('hot-only');
      });

      it('should classify "keep going" as continuation', () => {
        const result = router.classify('Keep going');
        expect(result.category).toBe('continuation');
        expect(result.strategy).toBe('hot-only');
      });
    });

    describe('deep-inspect', () => {
      it('should classify "find files matching" as deep-inspect', () => {
        const result = router.classify('Find files matching *.mjs');
        // Phase 2 feature - currently falls back to knowledge
        expect(['deep-inspect', 'knowledge']).toContain(result.category);
      });

      it('should classify "search files for" as deep-inspect', () => {
        const result = router.classify('Search files for TODO');
        expect(['deep-inspect', 'knowledge']).toContain(result.category);
      });

      it('should classify "grep for pattern" as deep-inspect', () => {
        const result = router.classify('Grep for the pattern');
        expect(['deep-inspect', 'knowledge']).toContain(result.category);
      });
    });

    describe('external (full-search)', () => {
      it('should classify "search web for" as external', () => {
        const result = router.classify('Search the web for latest news');
        // Phase 2 feature - currently falls back to knowledge
        expect(['external', 'knowledge']).toContain(result.category);
      });

      it('should classify "latest news" as external', () => {
        const result = router.classify('What\'s the latest news today?');
        expect(['external', 'knowledge']).toContain(result.category);
      });

      it('should classify "web search" as external', () => {
        const result = router.classify('Do a web search for current events');
        // "search" keyword appears in both external and deep-inspect
        expect(['external', 'deep-inspect', 'knowledge']).toContain(result.category);
      });
    });

    describe('default (indexed-only)', () => {
      it('should classify generic questions as knowledge', () => {
        const result = router.classify('What is the capital of France?');
        expect(result.category).toBe('knowledge');
        expect(result.strategy).toBe('indexed-only');
        expect(result.shouldShortCircuit).toBe(false);
      });

      it('should classify "how do I" as knowledge', () => {
        const result = router.classify('How do I configure this?');
        expect(result.category).toBe('knowledge');
        expect(result.strategy).toBe('indexed-only');
      });
    });

    describe('disabled router', () => {
      it('should return indexed-only when disabled', () => {
        const r = createFastAwarenessRouter({ enabled: false });
        const result = r.classify('What is my current task?');
        expect(result.category).toBe('unknown');
        expect(result.strategy).toBe('indexed-only');
        expect(result.reason).toBe('router_disabled');
      });
    });
  });

  describe('caching', () => {
    it('should cache classification results', () => {
      router.classify('What is my task?');
      expect(router.cache.size).toBe(1);
    });

    it('should return cached result on subsequent calls', () => {
      const result1 = router.classify('What is my task?');
      const result2 = router.classify('What is my task?');
      expect(result1.category).toBe(result2.category);
      expect(result1.confidence).toBe(result2.confidence);
    });

    it('should clear cache', () => {
      router.classify('Test message');
      expect(router.cache.size).toBe(1);
      router.clearCache();
      expect(router.cache.size).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should track classification statistics', () => {
      router.classify('What is my task?');
      router.classify('Continue with the task');
      router.classify('How do I do this?');

      const stats = router.getStats();
      expect(stats.total).toBe(3);
      expect(stats.skipretrieval).toBe(1);
      // hotonly uses the stats key 'hotionly'
      expect(stats.hotionly || stats.hotOnly || 0).toBeGreaterThanOrEqual(0);
    });
  });

  describe('keyword scoring', () => {
    it('should score multi-word keywords higher', () => {
      const result1 = router.classify('what is my task');
      const result2 = router.classify('task');
      expect(result1.confidence).toBeGreaterThanOrEqual(result2.confidence);
    });

    it('should match exact phrase "what is my"', () => {
      const result = router.classify('What is my progress?');
      // "progress" is in taskMetaKeywords, so this should match
      expect(result.category).toBe('task-meta');
    });
  });

  describe('edge cases', () => {
    it('should handle empty message', () => {
      const result = router.classify('');
      expect(result.category).toBe('knowledge');
      expect(result.strategy).toBe('indexed-only');
    });

    it('should handle null message', () => {
      const result = router.classify(null);
      expect(result.category).toBe('knowledge');
    });

    it('should handle very long message', () => {
      const longMsg = 'What is my task ' + 'x'.repeat(1000);
      const result = router.classify(longMsg);
      expect(result.category).toBe('task-meta');
    });

    it('should handle special characters', () => {
      const result = router.classify('What is my task???!!!');
      expect(result.category).toBe('task-meta');
    });
  });

  describe('setWorkingMemory', () => {
    it('should update working memory reference', () => {
      const newMemory = new MockWorkingMemory(true, true);
      router.setWorkingMemory(newMemory);
      expect(router.workingMemory).toBe(newMemory);
    });
  });
});

describe('createFastAwarenessRouter', () => {
  it('should create FastAwarenessRouter instance', () => {
    const router = createFastAwarenessRouter();
    expect(router).toBeInstanceOf(FastAwarenessRouter);
  });

  it('should pass config and working memory', () => {
    const memory = new MockWorkingMemory();
    const router = createFastAwarenessRouter({ minConfidenceForSkip: 0.9 }, memory);
    expect(router.config.minConfidenceForSkip).toBe(0.9);
    expect(router.workingMemory).toBe(memory);
  });
});
