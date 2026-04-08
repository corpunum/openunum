import { describe, it, expect } from 'vitest';
import { WorkingMemoryAnchor } from '../../src/core/working-memory.mjs';

describe('WorkingMemoryAnchor - Greeting Detection', () => {
  const wm = new WorkingMemoryAnchor({
    sessionId: 'test-session',
    workspaceRoot: '/tmp'
  });

  describe('_isSimpleGreeting', () => {
    it('should detect "Hi" as greeting', () => {
      const messages = [{ role: 'user', content: 'Hi' }];
      expect(wm._isSimpleGreeting(messages)).toBe(true);
    });

    it('should detect "Morning" as greeting', () => {
      const messages = [{ role: 'user', content: 'Morning' }];
      expect(wm._isSimpleGreeting(messages)).toBe(true);
    });

    it('should detect "Hello" as greeting', () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      expect(wm._isSimpleGreeting(messages)).toBe(true);
    });

    it('should detect "Good morning" as greeting', () => {
      const messages = [{ role: 'user', content: 'Good morning' }];
      expect(wm._isSimpleGreeting(messages)).toBe(true);
    });

    it('should detect name "Cemeral" as greeting', () => {
      const messages = [{ role: 'user', content: 'Cemeral' }];
      expect(wm._isSimpleGreeting(messages)).toBe(true);
    });

    it('should NOT detect "Hi, what is the status?" as greeting', () => {
      const messages = [{ role: 'user', content: 'Hi, what is the status?' }];
      expect(wm._isSimpleGreeting(messages)).toBe(false);
    });

    it('should NOT detect "Morning, continue with the task" as greeting', () => {
      const messages = [{ role: 'user', content: 'Morning, continue with the task' }];
      expect(wm._isSimpleGreeting(messages)).toBe(false);
    });

    it('should detect "Hi there" as greeting (simple two-word greeting)', () => {
      const messages = [{ role: 'user', content: 'Hi there' }];
      expect(wm._isSimpleGreeting(messages)).toBe(true);
    });

    it('should handle punctuation like "Hi!" and "Goodmorning!"', () => {
      expect(wm._isSimpleGreeting([{ role: 'user', content: 'Hi!' }])).toBe(true);
      expect(wm._isSimpleGreeting([{ role: 'user', content: 'Goodmorning!' }])).toBe(true);
      expect(wm._isSimpleGreeting([{ role: 'user', content: 'Good Morning!' }])).toBe(true);
    });

    it('should NOT detect long messages as greeting', () => {
      const messages = [{ role: 'user', content: 'Hello there my friend how are you doing today' }];
      expect(wm._isSimpleGreeting(messages)).toBe(false);
    });

    it('should handle empty messages', () => {
      expect(wm._isSimpleGreeting([])).toBe(false);
      expect(wm._isSimpleGreeting(null)).toBe(false);
      expect(wm._isSimpleGreeting([{ role: 'assistant', content: 'Hi' }])).toBe(false);
    });
  });
});
