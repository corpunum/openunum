import { describe, expect, it } from 'vitest';
import { trimMessagesToTokenBudget } from '../../src/core/context-compact.mjs';

describe('trimMessagesToTokenBudget', () => {
  it('preserves the first system message and trims oldest history first', () => {
    const messages = [
      { role: 'system', content: 'SESSION COMPACTION CHECKPOINT' },
      { role: 'user', content: 'old user '.repeat(400) },
      { role: 'assistant', content: 'old assistant '.repeat(400) },
      { role: 'user', content: 'recent user '.repeat(80) },
      { role: 'assistant', content: 'recent assistant '.repeat(80) }
    ];

    const out = trimMessagesToTokenBudget({
      messages,
      maxTokens: 900,
      preserveFirstSystem: true,
      minRecentMessages: 2
    });

    expect(out.postTokens).toBeLessThanOrEqual(900);
    expect(out.messages[0].content).toContain('SESSION COMPACTION CHECKPOINT');
    expect(out.messages.some((row) => String(row.content).includes('recent user'))).toBe(true);
    expect(out.droppedCount).toBeGreaterThan(0);
  });
});
