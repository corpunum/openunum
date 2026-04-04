export class TelegramChannel {
  constructor(config, onMessage, initialOffset = 0) {
    this.config = config;
    this.onMessage = onMessage;
    this.offset = initialOffset;
    this.maxLength = 4096; // Telegram message limit
  }

  /**
   * Get current offset (for persistence)
   */
  getOffset() {
    return this.offset;
  }

  api(path) {
    return `https://api.telegram.org/bot${this.config.botToken}${path}`;
  }

  // Split long messages at natural breakpoints (paragraphs, code blocks)
  chunkMessage(text) {
    const chunks = [];
    if (text.length <= this.maxLength) {
      return [text];
    }

    // Try splitting by double newlines (paragraphs) first
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';

    for (const para of paragraphs) {
      if ((currentChunk + '\n\n' + para).trim().length <= this.maxLength) {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        // If single paragraph exceeds limit, split by single newlines
        if (para.length > this.maxLength) {
          const lines = para.split('\n');
          currentChunk = '';
          for (const line of lines) {
            if ((currentChunk + '\n' + line).length <= this.maxLength) {
              currentChunk = currentChunk ? currentChunk + '\n' + line : line;
            } else {
              if (currentChunk) chunks.push(currentChunk.trim());
              // If still too long, hard split
              if (line.length > this.maxLength) {
                for (let i = 0; i < line.length; i += this.maxLength - 100) {
                  chunks.push(line.slice(i, i + this.maxLength - 100));
                }
              } else {
                currentChunk = line;
              }
            }
          }
        } else {
          currentChunk = para;
        }
      }
    }

    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
  }

  /**
   * Clean message for chat delivery — strip debug/technical artifacts
   */
  cleanForChat(text) {
    let cleaned = String(text || '');
    
    // Remove provenance footers
    cleaned = cleaned.replace(/\nProvenance:.*$/gm, '');
    
    // Remove any remaining JSON debug output patterns
    cleaned = cleaned.replace(/- (\w+): \{"ok":true[^}]+\}/g, (match, tool) => {
      return `- ${tool}: ✅ completed`;
    });
    
    // Remove tool_call artifacts that leaked through
    cleaned = cleaned.replace(/<\s*tool_call[^>]*>[\s\S]*?<\s*\/\s*tool_call\s*>/gi, '');
    cleaned = cleaned.replace(/<\s*function_call[^>]*>[\s\S]*?<\s*\/\s*function_call\s*>/gi, '');
    
    // Clean up excessive whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  async send(chatId, text) {
    const cleaned = this.cleanForChat(text);
    const chunks = this.chunkMessage(cleaned);
    const results = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const prefix = chunks.length > 1 ? `( ${i + 1}/${chunks.length} ) ` : '';
      const payload = { 
        chat_id: chatId, 
        text: prefix + chunk
      };
      
      // Only use Markdown for single-part messages that look safe
      // Disable for multi-part to avoid cross-chunk parsing issues
      if (chunks.length === 1) {
        payload.parse_mode = 'Markdown';
      }
      
      const res = await fetch(this.api('/sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'unknown');
        
        // If Markdown parsing fails, retry without parse_mode
        if (res.status === 400 && errorText.includes('can\'t parse entities')) {
          const retryPayload = { 
            chat_id: chatId, 
            text: prefix + chunk
          };
          const retryRes = await fetch(this.api('/sendMessage'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(retryPayload)
          });
          
          if (!retryRes.ok) {
            throw new Error(`Telegram send failed (${i + 1}/${chunks.length}): ${retryRes.status} - ${await retryRes.text().catch(() => 'unknown')}`);
          }
          results.push(await retryRes.json());
        } else {
          throw new Error(`Telegram send failed (${i + 1}/${chunks.length}): ${res.status} - ${errorText}`);
        }
      } else {
        results.push(await res.json());
      }
      
      // Small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return results;
  }

  async pollOnce() {
    const res = await fetch(this.api(`/getUpdates?timeout=20&offset=${this.offset}`));
    if (!res.ok) throw new Error(`Telegram poll failed: ${res.status}`);
    const data = await res.json();
    const updates = data?.result || [];
    for (const u of updates) {
      this.offset = Math.max(this.offset, u.update_id + 1);
      const msg = u.message?.text;
      const chatId = u.message?.chat?.id;
      if (!msg || !chatId) continue;
      const reply = await this.onMessage(msg, `telegram:${chatId}`);
      await this.send(chatId, reply);
    }
  }
}
