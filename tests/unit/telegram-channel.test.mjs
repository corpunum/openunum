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

  it('handles object messages with attachments', () => {
    const tg = new TelegramChannel({ botToken: 'x' }, async () => '', 0);
    const collapsed = tg.collapsePendingMessages([
      { text: 'look at this photo', attachments: [{ type: 'photo', fileId: 'abc123', fileName: 'selfie.jpg' }] },
      { text: 'what do you think?' }
    ]);
    expect(collapsed).toContain('[photo: selfie.jpg]');
    expect(collapsed).toContain('look at this photo');
    expect(collapsed).toContain('what do you think?');
  });
});

describe('TelegramChannel HTML formatting', () => {
  const tg = new TelegramChannel({ botToken: 'x' }, async () => '', 0);

  it('escapes HTML entities', () => {
    expect(tg.escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('strips markdown to plain text', () => {
    expect(tg.stripMarkdown('**bold** and *italic* and `code`')).toBe('bold and italic and code');
  });

  it('converts markdown to Telegram HTML', () => {
    const html = tg.markdownToTelegramHtml('Here is `inline code` and **bold** text.');
    expect(html).toContain('<code>inline code</code>');
    expect(html).toContain('<b>bold</b>');
  });

  it('formats final message with reasoning in expandable blockquote', () => {
    const html = tg.formatFinalMessage({
      reply: 'The answer is 42.',
      reasoning: 'I thought about it deeply.',
      toolCalls: []
    });
    expect(html).toContain('The answer is 42.');
    expect(html).toContain('<blockquote expandable>');
    expect(html).toContain('Reasoning');
    expect(html).toContain('I thought about it deeply.');
  });

  it('formats final message without reasoning when empty', () => {
    const html = tg.formatFinalMessage({
      reply: 'Simple answer.',
      reasoning: '',
      toolCalls: []
    });
    expect(html).toContain('Simple answer.');
    expect(html).not.toContain('<blockquote expandable>');
  });

  it('formats final message with tool calls in expandable blockquote', () => {
    const html = tg.formatFinalMessage({
      reply: 'Done.',
      reasoning: '',
      toolCalls: [
        { name: 'file_read', resultOk: true },
        { name: 'shell_run', resultOk: false, error: 'timeout' }
      ]
    });
    expect(html).toContain('Tools Used');
    expect(html).toContain('file_read ✅');
    expect(html).toContain('shell_run ❌');
    expect(html).toContain('<blockquote expandable>');
  });

  it('formats streaming message during reasoning phase', () => {
    const html = tg.formatStreamingMessage({
      content: '',
      reasoning: 'I need to think...',
      reasoningStarted: true,
      reasoningEnded: false,
      toolCalls: []
    });
    expect(html).toContain('Reasoning...');
    expect(html).toContain('I need to think');
  });

  it('formats streaming message with content and active tool calls', () => {
    const html = tg.formatStreamingMessage({
      content: 'Here is the answer',
      reasoning: '',
      reasoningStarted: false,
      reasoningEnded: true,
      toolCalls: [{ name: 'file_read', status: 'running' }]
    });
    expect(html).toContain('Here is the answer');
    expect(html).toContain('file_read');
  });

  it('shows placeholder when nothing has arrived yet', () => {
    const html = tg.formatStreamingMessage({
      content: '',
      reasoning: '',
      reasoningStarted: false,
      reasoningEnded: false,
      toolCalls: []
    });
    expect(html).toContain('Thinking...');
  });
});

describe('TelegramChannel cleanForChat', () => {
  const tg = new TelegramChannel({ botToken: 'x' }, async () => '', 0);

  it('strips base64 data from text', () => {
    const cleaned = tg.cleanForChat('Here is the image: data:image/png;base64,iVBORw0KGgoAAAANSUhEUg');
    expect(cleaned).toContain('[image attached]');
    expect(cleaned).not.toContain('iVBORw0KGgo');
  });

  it('strips long base64 strings', () => {
    const longB64 = 'A'.repeat(800);
    const cleaned = tg.cleanForChat('Result: ' + longB64);
    expect(cleaned).toContain('[base64 data removed]');
  });

  it('removes provenance footers', () => {
    const cleaned = tg.cleanForChat('some output\nProvenance: internal trace data');
    expect(cleaned).toContain('some output');
    expect(cleaned).not.toContain('Provenance');
  });
});