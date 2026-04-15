import { describe, expect, it } from 'vitest';
import { TelegramChannel } from '../../src/channels/telegram.mjs';

describe('TelegramChannel pending message collapse', () => {
  it('returns a single message unchanged', () => {
    const tg = new TelegramChannel({ botToken: 'x' }, async () => '', 0);
    expect(tg.collapsePendingMessages(['hello'])).toBe('hello');
  });

  it('collapses multiple queued messages into a latest-first directive', () => {
    const tg = new TelegramChannel({ botToken: 'x' }, async () => '', 0);
    const collapsed = tg.collapsePendingMessages(['first question', 'second clarification', 'So ... ?']);
    expect(collapsed).toContain('Queued Telegram messages arrived before the previous reply completed.');
    expect(collapsed).toContain('Latest message: So ... ?');
    expect(collapsed).toContain('1. first question');
    expect(collapsed).toContain('2. second clarification');
    expect(collapsed).toContain('Answer the latest message directly.');
  });

  it('replaces recovery stubs with a direct user-facing fallback', () => {
    const tg = new TelegramChannel({ botToken: 'x' }, async () => '', 0);
    const cleaned = tg.cleanForChat('Status: ok\nFindings:\nhttp_request: ✅ HTTP 200');
    expect(cleaned).toContain('internal diagnostics summary');
    expect(cleaned).not.toContain('Findings:');
  });
});
