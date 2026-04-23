import { describe, expect, it } from 'vitest';
import { ChannelBase } from '../../src/channels/base.mjs';

describe('ChannelBase', () => {
  const channel = new ChannelBase({});

  it('defaults all capability flags to false', () => {
    expect(channel.supportsStreaming).toBe(false);
    expect(channel.supportsHtml).toBe(false);
    expect(channel.supportsPhotos).toBe(false);
    expect(channel.supportsDocuments).toBe(false);
    expect(channel.supportsVoice).toBe(false);
  });

  it('escapes HTML entities', () => {
    expect(channel.escapeHtml('<div class="test">&</div>')).toBe('&lt;div class=&quot;test&quot;&gt;&amp;&lt;/div&gt;');
  });

  it('escapes single quotes', () => {
    expect(channel.escapeHtml("it's")).toBe('it&#39;s');
  });

  it('strips markdown formatting', () => {
    expect(channel.stripMarkdown('**bold** and *italic* and `code`')).toBe('bold and italic and code');
  });

  it('strips markdown links to just text', () => {
    expect(channel.stripMarkdown('[click here](https://example.com)')).toBe('click here');
  });

  it('strips code blocks preserving content', () => {
    const input = 'before ```js\nconsole.log("hi");\n``` after';
    const stripped = channel.stripMarkdown(input);
    expect(stripped).toContain('console.log');
    expect(stripped).toContain('before');
    expect(stripped).toContain('after');
  });

  it('chunks messages at 4096 chars by default', () => {
    const longText = 'a'.repeat(5000);
    const chunks = channel.chunkMessage(longText);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('preserves paragraphs in chunking', () => {
    const text = 'para1\n\npara2\n\npara3';
    const chunks = channel.chunkMessage(text);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(text);
  });
});