export class OpenAICompatibleProvider {
  constructor({ baseUrl, apiKey, model }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat({ messages, tools = [] }) {
    const body = {
      model: this.model,
      messages,
      temperature: 0.2,
      tools: tools.length > 0 ? tools : undefined
    };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey ? `Bearer ${this.apiKey}` : ''
      },
      body: JSON.stringify(body)
    });
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
