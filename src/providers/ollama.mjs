export class OllamaProvider {
  constructor({ baseUrl, model }) {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async chat({ messages, tools = [] }) {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model.replace(/^ollama\//, ''),
        messages,
        stream: false,
        tools: tools.length > 0 ? tools : undefined
      })
    });
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
