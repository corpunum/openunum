export class OllamaProvider {
  constructor({ baseUrl, model, timeoutMs = 120000 }) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.timeoutMs = Number.isFinite(timeoutMs) ? Number(timeoutMs) : 120000;
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
          messages,
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
      arguments: JSON.stringify(tc.function?.arguments || {})
    }));
    return {
      content: json?.message?.content || '',
      toolCalls
    };
  }
}
