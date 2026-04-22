export class OpenAICompatibleProvider {
  constructor({ baseUrl, apiKey, model, timeoutMs = 120000 }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = Number.isFinite(timeoutMs) ? Number(timeoutMs) : 120000;
  }

  async chat({ messages, tools = [], timeoutMs, nativeWebSearch = false }) {
    const effectiveTimeout = Number.isFinite(timeoutMs)
      ? Math.max(1000, Number(timeoutMs))
      : this.timeoutMs;
    const toolDefs = tools.length > 0
      ? tools
      : (nativeWebSearch ? [{ type: 'web_search_preview' }] : undefined);
    const body = {
      model: this.model,
      messages,
      temperature: 0.2,
      tools: toolDefs,
      tool_choice: nativeWebSearch ? 'auto' : undefined
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), effectiveTimeout);
    let res;
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`OpenAI-compatible provider timeout after ${effectiveTimeout}ms`);
      }
      const details = [
        error?.name,
        error?.message,
        error?.cause?.code,
        error?.cause?.message
      ].filter(Boolean).join(' | ');
      throw new Error(`OpenAI-compatible provider fetch failed${details ? `: ${details}` : ''}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI-compatible provider failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    const msg = json?.choices?.[0]?.message || {};
    let content = msg.content || '';
    if (Array.isArray(content)) {
      content = content
        .map((p) => {
          if (typeof p === 'string') return p;
          if (p?.type === 'text') return p.text || '';
          return '';
        })
        .join('\n')
        .trim();
    }
    const toolCalls = (msg.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: tc.function?.arguments ?? '{}'
    }));
    return {
      content,
      reasoning: msg.reasoning_content || '',
      toolCalls
    };
  }

  async chatStream({ messages, tools = [], timeoutMs, onContentDelta, onReasoningDelta, nativeWebSearch = false }) {
    const effectiveTimeout = Number.isFinite(timeoutMs)
      ? Math.max(1000, Number(timeoutMs))
      : this.timeoutMs;
    const toolDefs = tools.length > 0
      ? tools
      : (nativeWebSearch ? [{ type: 'web_search_preview' }] : undefined);
    const body = {
      model: this.model,
      messages,
      temperature: 0.2,
      stream: true,
      tools: toolDefs,
      tool_choice: nativeWebSearch ? 'auto' : undefined
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), effectiveTimeout);
    let res;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      if (error?.name === 'AbortError') {
        throw new Error(`OpenAI-compatible provider timeout after ${effectiveTimeout}ms`);
      }
      throw new Error(`OpenAI-compatible provider stream fetch failed: ${error?.message || error}`);
    }
    if (!res.ok) {
      clearTimeout(timer);
      const text = await res.text();
      throw new Error(`OpenAI-compatible provider stream failed: ${res.status} ${text}`);
    }

    const contentParts = [];
    const reasoningParts = [];
    const toolCallMap = new Map();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;
          let chunk;
          try { chunk = JSON.parse(trimmed.slice(6)); } catch { continue; }
          const delta = chunk?.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.reasoning_content) {
            reasoningParts.push(delta.reasoning_content);
            if (onReasoningDelta) onReasoningDelta(delta.reasoning_content);
          }
          if (delta.content) {
            contentParts.push(delta.content);
            if (onContentDelta) onContentDelta(delta.content);
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap.has(idx)) {
                toolCallMap.set(idx, { id: tc.id || '', name: '', arguments: '' });
              }
              const entry = toolCallMap.get(idx);
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name = tc.function.name;
              if (tc.function?.arguments) entry.arguments += tc.function.arguments;
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
      reader.cancel().catch(() => {});
    }

    const content = contentParts.join('');
    const reasoning = reasoningParts.join('');
    const toolCalls = [...toolCallMap.values()].map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments || '{}'
    }));
    return { content, reasoning, toolCalls };
  }
}
