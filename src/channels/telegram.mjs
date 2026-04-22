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

  collapsePendingMessages(messages = []) {
    const items = messages.map((item) => String(item || '').trim()).filter(Boolean);
    if (!items.length) return '';
    if (items.length === 1) return items[0];
    const latest = items[items.length - 1];
    const earlier = items.slice(0, -1).slice(-3);
    return [
      'Queued Telegram messages arrived before the previous reply completed.',
      `Latest message: ${latest}`,
      earlier.length ? 'Earlier pending messages for context only:' : '',
      ...earlier.map((item, index) => `${index + 1}. ${item}`),
      'Answer the latest message directly. Use earlier messages only as context.'
    ].filter(Boolean).join('\n');
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

    // Remove base64 image data (from image_generate tool results that leak into text)
    cleaned = cleaned.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=\n]+/g, '[image attached]');
    cleaned = cleaned.replace(/\b[A-Za-z0-9+/]{200,}={0,2}\b/g, (match) => {
      return match.length > 500 ? '[base64 data removed]' : match;
    });

    // Remove provenance footers
    cleaned = cleaned.replace(/\nProvenance:.*$/gm, '');
    
    // Remove any remaining JSON debug output patterns
    cleaned = cleaned.replace(/- (\w+): \{"ok":true[^}]+\}/g, (match, tool) => {
      return `- ${tool}: ✅ completed`;
    });
    
    // Remove tool_call artifacts that leaked through
    cleaned = cleaned.replace(/<\s*tool_call[^>]*>[\s\S]*?<\s*\/\s*tool_call\s*>/gi, '');
    cleaned = cleaned.replace(/<\s*function_call[^>]*>[\s\S]*?<\s*\/\s*function_call\s*>/gi, '');

    // Fail-safe: never deliver internal recovery stubs as user-facing Telegram output.
    if ((/^Status:\s+\w+/i.test(cleaned) && /Findings:/i.test(cleaned)) || /^Best next steps from current evidence:/i.test(cleaned)) {
      cleaned = 'I produced an internal diagnostics summary instead of a direct answer. Please resend your last request, and I will answer it directly.';
    }
    
    // Clean up excessive whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  async clearWebhook({ dropPendingUpdates = false } = {}) {
    const res = await fetch(this.api('/deleteWebhook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: Boolean(dropPendingUpdates) })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Telegram deleteWebhook failed: ${res.status} ${res.statusText} ${body}`.trim());
    }
    return res.json().catch(() => ({ ok: true }));
  }

  async sendPhoto(chatId, base64Data, caption = '') {
    const buffer = Buffer.from(base64Data, 'base64');
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('photo', new Blob([buffer], { type: 'image/png' }), 'image.png');
    if (caption) {
      formData.append('caption', caption.length > 1024 ? caption.slice(0, 1021) + '...' : caption);
    }

    const res = await fetch(this.api('/sendPhoto'), {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'unknown');
      throw new Error(`Telegram sendPhoto failed: ${res.status} - ${errorText}`);
    }
    return res.json();
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

  async pollOnce(retryCount = 0, maxRetries = 3) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout (slightly longer than poll timeout=20)
    
    try {
      const res = await fetch(this.api(`/getUpdates?timeout=20&offset=${this.offset}`), {
        signal: controller.signal
      });
      
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Telegram poll failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`);
      }
      
      const data = await res.json();
      const updates = data?.result || [];

      const pendingByChat = new Map();
      for (const u of updates) {
        this.offset = Math.max(this.offset, u.update_id + 1);
        const msg = u.message?.text;
        const chatId = u.message?.chat?.id;
        if (!msg || !chatId) continue;
        const queue = pendingByChat.get(chatId) || [];
        queue.push(msg);
        pendingByChat.set(chatId, queue);
      }

      for (const [chatId, messages] of pendingByChat.entries()) {
        const collapsed = this.collapsePendingMessages(messages);
        if (!collapsed) continue;
        try {
          const reply = await this.onMessage(collapsed, `telegram:${chatId}`);
          // Support both string replies (legacy) and object replies with images
          if (typeof reply === 'object' && reply !== null) {
            const text = String(reply.reply || '').trim();
            const images = Array.isArray(reply.images) ? reply.images : [];
            // Send images first, then text
            for (const img of images) {
              try {
                await this.sendPhoto(chatId, img, text.length > 1024 ? text.slice(0, 1021) + '...' : '');
              } catch (photoErr) {
                // Photo send failed, will still send text below
              }
            }
            if (text) {
              await this.send(chatId, text);
            }
          } else {
            await this.send(chatId, String(reply || ''));
          }
        } catch (chatError) {
          const fallback = 'I hit an internal processing error for your message. Please retry.';
          try {
            await this.send(chatId, fallback);
          } catch {}
          // Do not fail the entire polling pass for one chat.
        }
      }
    } catch (err) {
      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, delay));
        return this.pollOnce(retryCount + 1, maxRetries);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
