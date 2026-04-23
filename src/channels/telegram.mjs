import { ChannelBase } from './base.mjs';
import { onAgentEvent, AGENT_EVENTS } from '../core/agent-events.mjs';

export class TelegramChannel extends ChannelBase {
  constructor(config, onMessage, initialOffset = 0) {
    super(config);
    this.onMessage = onMessage;
    this.offset = initialOffset;
    this.maxLength = 4096;
  }

  get supportsStreaming() { return true; }
  get supportsHtml() { return true; }
  get supportsPhotos() { return true; }
  get supportsDocuments() { return true; }
  get supportsVoice() { return true; }

  getOffset() {
    return this.offset;
  }

  api(path) {
    return `https://api.telegram.org/bot${this.config.botToken}${path}`;
  }

  fileUrl(filePath) {
    return `https://api.telegram.org/file/bot${this.config.botToken}/${filePath}`;
  }

  collapsePendingMessages(messages = []) {
    const items = messages.map((item) => {
      const text = String(typeof item === 'string' ? item : (item?.text || '')).trim();
      const attachments = typeof item === 'string' ? [] : (item?.attachments || []);
      const mediaDesc = attachments.map((a) =>
        `[${a.type}: ${a.fileName || a.mimeType || a.fileId}]`
      ).join(' ');
      return [text, mediaDesc].filter(Boolean).join(' ');
    }).filter(Boolean);
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

  chunkMessage(text, maxLength = 4096) {
    return super.chunkMessage(text, maxLength);
  }

  cleanForChat(text) {
    let cleaned = String(text || '');
    cleaned = cleaned.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=\n]+/g, '[image attached]');
    cleaned = cleaned.replace(/\b[A-Za-z0-9+/]{200,}={0,2}\b/g, (match) => {
      return match.length > 500 ? '[base64 data removed]' : match;
    });
    cleaned = cleaned.replace(/\nProvenance:.*$/gm, '');
    cleaned = cleaned.replace(/- (\w+): \{"ok":true[^}]+\}/g, (match, tool) => {
      return `- ${tool}: completed`;
    });
    cleaned = cleaned.replace(/<\s*tool_call[^>]*>[\s\S]*?<\s*\/\s*tool_call\s*>/gi, '');
    cleaned = cleaned.replace(/<\s*function_call[^>]*>[\s\S]*?<\s*\/\s*function_call\s*>/gi, '');
    if ((/^Status:\s+\w+/i.test(cleaned) && /Findings:/i.test(cleaned)) || /^Best next steps from current evidence:/i.test(cleaned)) {
      cleaned = 'I produced an internal diagnostics summary instead of a direct answer. Please resend your last request, and I will answer it directly.';
    }
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.trim();
    return cleaned;
  }

  // --- Markdown to Telegram HTML converter ---

  markdownToTelegramHtml(text) {
    if (!text) return '';
    let html = this.escapeHtml(text);
    // Code blocks: ```lang\n...\n```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const langAttr = lang ? ` class="language-${lang}"` : '';
      return `<pre><code${langAttr}>${code.trim()}</code></pre>`;
    });
    // Inline code: `text`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold: **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    // Italic: *text*
    html = html.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<i>$1</i>');
    // Links: [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Unordered list items: - item or * item (Telegram has no <ul>, use unicode bullet)
    html = html.replace(/^[\-\*] (.+)$/gm, '• $1');
    // Headers: ### text → <b>text</b>
    html = html.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
    return html;
  }

  // --- Formatted message with collapsible sections ---

  formatFinalMessage({ reply, reasoning = '', toolCalls = [] }) {
    let html = this.markdownToTelegramHtml(reply);

    if (reasoning && reasoning.trim()) {
      html += '\n<blockquote expandable>';
      html += '<b>Reasoning</b>\n';
      html += this.escapeHtml(reasoning.trim());
      html += '</blockquote>';
    }

    if (toolCalls.length > 0) {
      html += '\n<blockquote expandable>';
      html += '<b>Tools Used</b>\n';
      for (const tc of toolCalls) {
        const name = this.escapeHtml(tc.name || tc.tool || '?');
        const status = tc.resultOk ? ' ✅' : (tc.error ? ' ❌' : '');
        html += `• ${name}${status}\n`;
      }
      html += '</blockquote>';
    }

    return html;
  }

  formatStreamingMessage({ content = '', reasoning = '', reasoningStarted = false, reasoningEnded = false, toolCalls = [] }) {
    let html = '';

    if (reasoningStarted && !reasoningEnded && content.length === 0) {
      html = '<i>Reasoning...</i>';
      if (reasoning.length > 0) {
        const preview = reasoning.length > 300 ? reasoning.slice(0, 300) + '...' : reasoning;
        html += '\n' + this.escapeHtml(preview);
      }
      return html;
    }

    if (content.length > 0) {
      html = this.markdownToTelegramHtml(content);
      // Trailing cursor to show generation is in progress
      if (!reasoningEnded || content.length < 50) {
        html += ' █';
      }
    }

    if (reasoningStarted && reasoning.length > 0 && !reasoningEnded) {
      html += '\n<i>Still reasoning...</i>';
    }

    if (toolCalls.length > 0) {
      const active = toolCalls.filter((tc) => tc.status === 'running');
      if (active.length > 0) {
        html += '\n<i>';
        html += active.map((tc) => `${tc.name}...`).join(', ');
        html += '</i>';
      }
    }

    return html || '<i>Thinking...</i>';
  }

  // --- Telegram API methods ---

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
    const res = await fetch(this.api('/sendPhoto'), { method: 'POST', body: formData });
    if (!res.ok) {
      const errorText = await res.text().catch(() => 'unknown');
      throw new Error(`Telegram sendPhoto failed: ${res.status} - ${errorText}`);
    }
    return res.json();
  }

  async sendDocument(chatId, buffer, fileName, mimeType, caption = '') {
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('document', new Blob([buffer], { type: mimeType }), fileName);
    if (caption) {
      formData.append('caption', caption.length > 1024 ? caption.slice(0, 1021) + '...' : caption);
    }
    const res = await fetch(this.api('/sendDocument'), { method: 'POST', body: formData });
    if (!res.ok) {
      const errorText = await res.text().catch(() => 'unknown');
      throw new Error(`Telegram sendDocument failed: ${res.status} - ${errorText}`);
    }
    return res.json();
  }

  async sendVoice(chatId, buffer, duration, caption = '') {
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('voice', new Blob([buffer], { type: 'audio/ogg' }), 'voice.ogg');
    if (duration) formData.append('duration', String(duration));
    if (caption) {
      formData.append('caption', caption.length > 1024 ? caption.slice(0, 1021) + '...' : caption);
    }
    const res = await fetch(this.api('/sendVoice'), { method: 'POST', body: formData });
    if (!res.ok) {
      const errorText = await res.text().catch(() => 'unknown');
      throw new Error(`Telegram sendVoice failed: ${res.status} - ${errorText}`);
    }
    return res.json();
  }

  async sendAudio(chatId, buffer, fileName, mimeType, caption = '') {
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('audio', new Blob([buffer], { type: mimeType }), fileName);
    if (caption) {
      formData.append('caption', caption.length > 1024 ? caption.slice(0, 1021) + '...' : caption);
    }
    const res = await fetch(this.api('/sendAudio'), { method: 'POST', body: formData });
    if (!res.ok) {
      const errorText = await res.text().catch(() => 'unknown');
      throw new Error(`Telegram sendAudio failed: ${res.status} - ${errorText}`);
    }
    return res.json();
  }

  async send(chatId, text, { parseMode = 'Markdown' } = {}) {
    const cleaned = this.cleanForChat(text);
    const chunks = this.chunkMessage(cleaned);
    const results = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const prefix = chunks.length > 1 ? `( ${i + 1}/${chunks.length} ) ` : '';
      const payload = {
        chat_id: chatId,
        text: prefix + chunk,
        parse_mode: parseMode
      };

      const res = await fetch(this.api('/sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'unknown');
        if (res.status === 400 && /can't parse entities/i.test(errorText)) {
          const retryPayload = { chat_id: chatId, text: prefix + chunk };
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

      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return results;
  }

  async sendHtml(chatId, html) {
    const payload = { chat_id: chatId, text: html, parse_mode: 'HTML' };
    const res = await fetch(this.api('/sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 400 && /can't parse entities/i.test(errText)) {
        const plain = this.stripMarkdown(html.replace(/<[^>]+>/g, ''));
        return this.send(chatId, plain, { parseMode: undefined });
      }
      throw new Error(`Telegram sendHtml failed: ${res.status} - ${errText}`);
    }
    return res.json();
  }

  async editMessage(chatId, messageId, text, { parseMode = 'HTML' } = {}) {
    const payload = {
      chat_id: String(chatId),
      message_id: Number(messageId),
      text,
      parse_mode: parseMode
    };
    const res = await fetch(this.api('/editMessageText'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (errText.includes('message is not modified')) return { ok: true };
      throw new Error(`Telegram editMessageText failed: ${res.status} - ${errText}`);
    }
    return res.json();
  }

  // --- File download ---

  async getFile(fileId) {
    const res = await fetch(this.api(`/getFile?file_id=${fileId}`));
    if (!res.ok) throw new Error(`Telegram getFile failed: ${res.status}`);
    const data = await res.json();
    const filePath = data?.result?.file_path;
    if (!filePath) throw new Error('Telegram getFile returned no file_path');
    const fileRes = await fetch(this.fileUrl(filePath));
    if (!fileRes.ok) throw new Error(`Telegram file download failed: ${fileRes.status}`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return { buffer, filePath, mimeType: fileRes.headers.get('content-type') || 'application/octet-stream' };
  }

  async downloadAttachment(attachment) {
    const { buffer, mimeType, filePath } = await this.getFile(attachment.fileId);
    return {
      buffer,
      mimeType: mimeType || attachment.mimeType || 'application/octet-stream',
      fileName: attachment.fileName || filePath.split('/').pop(),
      type: attachment.type
    };
  }

  // --- Full response delivery ---

  async deliverFullResponse(chatId, agentResult) {
    const reply = String(agentResult?.reply || '').trim();
    const images = Array.isArray(agentResult?.images) ? agentResult.images : [];
    const reasoning = agentResult?.reasoning || '';
    const toolCalls = [];

    // Extract tool call info from trace if available
    if (agentResult?.trace?.iterations) {
      for (const iter of agentResult.trace.iterations) {
        if (Array.isArray(iter.toolCalls)) {
          for (const tc of iter.toolCalls) {
            toolCalls.push({ name: tc.name, resultOk: tc.result?.ok, error: tc.result?.error });
          }
        }
      }
    }

    // 1. Send images first (with caption on first image if reply is short enough)
    for (let i = 0; i < images.length; i++) {
      const caption = (i === 0 && reply.length <= 1024) ? reply : '';
      try {
        await this.sendPhoto(chatId, images[i], caption);
      } catch { /* photo send failed, still send text below */ }
    }

    // 2. Send text reply with collapsible sections
    if (reply) {
      const imagesCaptioned = images.length > 0 && reply.length <= 1024;
      if (imagesCaptioned) {
        // Reply was already sent as photo caption; send reasoning/tools separately if needed
        if ((reasoning && reasoning.trim()) || toolCalls.length > 0) {
          const sectionsHtml = this.formatFinalMessage({ reply: '', reasoning, toolCalls });
          if (sectionsHtml.trim()) {
            await this.sendHtml(chatId, sectionsHtml);
          }
        }
      } else if ((reasoning && reasoning.trim()) || toolCalls.length > 0) {
        // Rich HTML with collapsible sections
        const html = this.formatFinalMessage({ reply, reasoning, toolCalls });
        // If total exceeds 4096, split: reply first, then reasoning/tools
        if (html.length > 4096) {
          const replyHtml = this.markdownToTelegramHtml(reply);
          await this.sendHtml(chatId, replyHtml);
          const sectionsHtml = this.formatFinalMessage({ reply: '', reasoning, toolCalls });
          if (sectionsHtml.trim()) {
            await this.sendHtml(chatId, sectionsHtml);
          }
        } else {
          await this.sendHtml(chatId, html);
        }
      } else {
        // Plain text, no collapsible sections needed
        await this.send(chatId, reply);
      }
    }
  }

  // --- Streaming reply ---

  async streamingReply(chatId, sessionId, agentChatPromise, { editIntervalMs = 1500, placeholderText = 'Thinking...' } = {}) {
    // 1. Send placeholder
    let messageId;
    try {
      const placeholder = await this.sendHtml(chatId, placeholderText);
      messageId = placeholder?.result?.message_id;
    } catch {
      // If placeholder fails, fall back to non-streaming
      const out = await agentChatPromise;
      await this.deliverFullResponse(chatId, out);
      return out;
    }

    if (!messageId) {
      const out = await agentChatPromise;
      await this.deliverFullResponse(chatId, out);
      return out;
    }

    // 2. Subscribe to agent events
    let contentBuf = '';
    let reasoningBuf = '';
    let reasoningStarted = false;
    let reasoningEnded = false;
    const toolCalls = [];
    let turnEnded = false;

    const unsubscribers = [];

    const subscribe = (event, handler) => {
      const unsub = onAgentEvent(event, handler);
      unsubscribers.push(unsub);
    };

    subscribe(AGENT_EVENTS.CONTENT_DELTA, (data) => {
      if (data.sessionId !== sessionId) return;
      if (data.token) contentBuf += data.token;
    });

    subscribe(AGENT_EVENTS.REASONING_START, (data) => {
      if (data.sessionId !== sessionId) return;
      reasoningStarted = true;
    });

    subscribe(AGENT_EVENTS.REASONING_DELTA, (data) => {
      if (data.sessionId !== sessionId) return;
      if (data.token) reasoningBuf += data.token;
    });

    subscribe(AGENT_EVENTS.REASONING_END, (data) => {
      if (data.sessionId !== sessionId) return;
      reasoningEnded = true;
    });

    subscribe(AGENT_EVENTS.TOOL_CALL_STARTED, (data) => {
      if (data.sessionId !== sessionId) return;
      toolCalls.push({ name: data.tool, status: 'running', resultOk: false, error: null });
    });

    subscribe(AGENT_EVENTS.TOOL_CALL_COMPLETED, (data) => {
      if (data.sessionId !== sessionId) return;
      const tc = toolCalls.find((t) => t.name === data.tool && t.status === 'running');
      if (tc) { tc.status = 'completed'; tc.resultOk = data.resultOk !== false; }
    });

    subscribe(AGENT_EVENTS.TOOL_CALL_FAILED, (data) => {
      if (data.sessionId !== sessionId) return;
      const tc = toolCalls.find((t) => t.name === data.tool && t.status === 'running');
      if (tc) { tc.status = 'failed'; tc.error = data.error; }
    });

    subscribe(AGENT_EVENTS.TURN_END, (data) => {
      if (data.sessionId !== sessionId) return;
      turnEnded = true;
    });

    // 3. Edit timer
    let lastEditAt = 0;
    let editTimer = null;

    const scheduleEdit = () => {
      if (turnEnded) return;
      const elapsed = Date.now() - lastEditAt;
      const delay = Math.max(0, editIntervalMs - elapsed);
      editTimer = setTimeout(async () => {
        if (turnEnded) return;
        lastEditAt = Date.now();
        try {
          const html = this.formatStreamingMessage({
            content: contentBuf,
            reasoning: reasoningBuf,
            reasoningStarted,
            reasoningEnded,
            toolCalls
          });
          if (html && html.length > 0) {
            await this.editMessage(chatId, messageId, html);
          }
        } catch { /* edit failed, retry next tick */ }
        scheduleEdit();
      }, delay);
    };
    scheduleEdit();

    // 4. Await completion
    let out;
    try {
      out = await agentChatPromise;
    } catch (err) {
      out = { reply: 'I encountered an error processing your message. Please retry.', images: [] };
    }

    // 5. Final edit with collapsible sections
    turnEnded = true;
    if (editTimer) clearTimeout(editTimer);
    for (const unsub of unsubscribers) {
      try { unsub(); } catch { /* best effort */ }
    }

    const finalReasoning = out?.reasoning || reasoningBuf;
    const finalToolCalls = toolCalls.map((tc) => ({
      name: tc.name,
      resultOk: tc.resultOk,
      error: tc.error
    }));

    try {
      const finalHtml = this.formatFinalMessage({
        reply: out?.reply || contentBuf,
        reasoning: finalReasoning,
        toolCalls: finalToolCalls
      });
      if (finalHtml.length <= 4096) {
        await this.editMessage(chatId, messageId, finalHtml);
      } else {
        // Too long for editMessage — send reply as new message, then reasoning/tools
        const replyHtml = this.markdownToTelegramHtml(out?.reply || contentBuf);
        await this.sendHtml(chatId, replyHtml);
        const sectionsHtml = this.formatFinalMessage({ reply: '', reasoning: finalReasoning, toolCalls: finalToolCalls });
        if (sectionsHtml.trim()) {
          await this.sendHtml(chatId, sectionsHtml);
        }
      }
    } catch {
      // If edit fails, fall back to sending new messages
      await this.deliverFullResponse(chatId, out);
    }

    // 6. Deliver images (not via editMessageText)
    if (Array.isArray(out?.images) && out.images.length > 0) {
      for (const img of out.images) {
        try { await this.sendPhoto(chatId, img); } catch { /* best effort */ }
      }
    }

    return out;
  }

  // --- Polling ---

  async pollOnce(retryCount = 0, maxRetries = 3) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

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
      const attachmentsByChat = new Map();

      for (const u of updates) {
        this.offset = Math.max(this.offset, u.update_id + 1);
        const chatId = u.message?.chat?.id;
        if (!chatId) continue;

        // Extract text content
        let text = u.message?.text || u.message?.caption || '';

        // Extract media attachments
        const attachments = [];
        if (u.message?.photo) {
          const largest = u.message.photo[u.message.photo.length - 1];
          attachments.push({ type: 'photo', fileId: largest.file_id, width: largest.width, height: largest.height });
        }
        if (u.message?.document) {
          attachments.push({
            type: 'document', fileId: u.message.document.file_id,
            fileName: u.message.document.file_name,
            mimeType: u.message.document.mime_type
          });
        }
        if (u.message?.voice) {
          attachments.push({
            type: 'voice', fileId: u.message.voice.file_id,
            duration: u.message.voice.duration,
            mimeType: u.message.voice.mime_type
          });
        }
        if (u.message?.audio) {
          attachments.push({
            type: 'audio', fileId: u.message.audio.file_id,
            duration: u.message.audio.duration,
            title: u.message.audio.title,
            mimeType: u.message.audio.mime_type
          });
        }

        if (!text && !attachments.length) continue;

        const queue = pendingByChat.get(chatId) || [];
        queue.push({ text, attachments });
        pendingByChat.set(chatId, queue);

        const allAttachments = attachmentsByChat.get(chatId) || [];
        allAttachments.push(...attachments);
        attachmentsByChat.set(chatId, allAttachments);
      }

      for (const [chatId, messages] of pendingByChat.entries()) {
        const collapsed = this.collapsePendingMessages(messages);
        const allAttachments = attachmentsByChat.get(chatId) || [];
        if (!collapsed && !allAttachments.length) continue;
        try {
          const reply = await this.onMessage(collapsed || '[media]', `telegram:${chatId}`, { attachments: allAttachments });
          // Legacy: if onMessage returns a plain string or simple object, deliver it
          if (typeof reply === 'string' && reply.trim()) {
            await this.send(chatId, reply);
          } else if (typeof reply === 'object' && reply !== null && !reply.sessionId) {
            // Simple { reply, images } object — deliver directly (non-streaming fallback)
            await this.deliverFullResponse(chatId, reply);
          }
          // If it's a full agent result (has sessionId), streamingReply already handled delivery
        } catch (chatError) {
          const fallback = 'I hit an internal processing error for your message. Please retry.';
          try { await this.send(chatId, fallback); } catch { /* do not fail polling for one chat */ }
        }
      }
    } catch (err) {
      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(r => setTimeout(r, delay));
        return this.pollOnce(retryCount + 1, maxRetries);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
