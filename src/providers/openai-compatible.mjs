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
      toolCalls
    };
  }
}
