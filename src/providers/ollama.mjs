export class OllamaProvider {
  constructor({ baseUrl, model, timeoutMs = 120000 }) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.timeoutMs = Number.isFinite(timeoutMs) ? Number(timeoutMs) : 120000;
  }

  static normalizeToolArguments(raw) {
    if (raw == null) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
    if (typeof raw !== 'string') return {};
    const text = raw.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch {
      return {};
    }
  }

  static normalizeMessages(messages = []) {
    return (Array.isArray(messages) ? messages : []).map((msg) => {
      const role = String(msg?.role || 'user');
      const normalized = {
        role,
        content: String(msg?.content || '')
      };
      if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
        normalized.tool_calls = msg.tool_calls.map((tc, idx) => ({
          id: String(tc?.id || `tc-${idx}`),
          type: 'function',
          function: {
            name: String(tc?.function?.name || tc?.name || ''),
            arguments: OllamaProvider.normalizeToolArguments(tc?.function?.arguments ?? tc?.arguments)
          }
        })).filter((tc) => tc.function.name);
        if (!normalized.tool_calls.length) delete normalized.tool_calls;
      }
      if (role === 'tool' && msg?.tool_call_id) {
        normalized.tool_call_id = String(msg.tool_call_id);
      }
      return normalized;
    });
  }

  async chat({ messages, tools = [], timeoutMs }) {
    const effectiveTimeout = Number.isFinite(timeoutMs)
      ? Math.max(1000, Math.min(Number(timeoutMs), this.timeoutMs))
      : this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), effectiveTimeout);
    let res;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model.replace(/^ollama\//, ''),
          messages: OllamaProvider.normalizeMessages(messages),
          stream: false,
          tools: tools.length > 0 ? tools : undefined
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Ollama provider timeout after ${effectiveTimeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama provider failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    const toolCalls = (json?.message?.tool_calls || []).map((tc, idx) => ({
      id: tc.id || `ollama-${idx}`,
      name: tc.function?.name,
      arguments: JSON.stringify(OllamaProvider.normalizeToolArguments(tc.function?.arguments))
    }));
    return {
      content: json?.message?.content || '',
      toolCalls
    };
  }
}
