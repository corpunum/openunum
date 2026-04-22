export class OllamaProvider {
  constructor({ baseUrl, model, timeoutMs = 120000 }) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.timeoutMs = Number.isFinite(timeoutMs) ? Number(timeoutMs) : 120000;
  }

  static normalizeModelRef(model) {
    return String(model || '')
      .trim()
      .replace(/^(ollama-local|ollama-cloud|ollama|openrouter|nvidia|xiaomimimo|generic|openai)\//, '');
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

  static parseMissingModelFromError(text) {
    const message = String(text || '');
    const m = message.match(/model '([^']+)' not found/i);
    return m ? String(m[1] || '').trim() : '';
  }

  async listKnownModels() {
    const res = await fetch(`${this.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.models || [])
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean);
  }

  static pickFallbackModel(requestedModel, knownModels = []) {
    const req = OllamaProvider.normalizeModelRef(requestedModel);
    const known = (Array.isArray(knownModels) ? knownModels : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean);
    if (!known.length) return null;
    const lowerKnown = known.map((name) => name.toLowerCase());
    const reqLower = req.toLowerCase();
    const exactIdx = lowerKnown.indexOf(reqLower);
    if (exactIdx !== -1) return known[exactIdx];

    const requestedBase = req.split(':')[0]?.toLowerCase() || '';
    if (requestedBase) {
      const sameBaseIdx = lowerKnown.findIndex((name) => name.startsWith(`${requestedBase}:`) || name === requestedBase);
      if (sameBaseIdx !== -1) return known[sameBaseIdx];
    }

    if (reqLower.endsWith(':cloud') || reqLower.includes('cloud')) {
      const preferredCloud = [
        'minimax-m2.7:cloud',
        'kimi-k2.5:cloud',
        'glm-5:cloud',
        'qwen3.5:397b-cloud'
      ];
      for (const preferred of preferredCloud) {
        const idx = lowerKnown.indexOf(preferred);
        if (idx !== -1) return known[idx];
      }
      const anyCloudIdx = lowerKnown.findIndex((name) => name.includes(':cloud') || name.includes('-cloud'));
      if (anyCloudIdx !== -1) return known[anyCloudIdx];
    }

    return known[0];
  }

  async chat({ messages, tools = [], timeoutMs }) {
    const effectiveTimeout = Number.isFinite(timeoutMs)
      ? Math.max(1000, Number(timeoutMs))
      : this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), effectiveTimeout);
    const rawModel = String(this.model || '').trim();
    const modelPrefixMatch = rawModel.match(/^([a-z0-9-]+)\//i);
    const modelPrefix = modelPrefixMatch ? String(modelPrefixMatch[1] || '').toLowerCase() : '';
    const requestedModel = OllamaProvider.normalizeModelRef(rawModel);
    const forceCpu = modelPrefix === 'ollama-local' || /:cpu$/i.test(requestedModel);
    const requestBody = {
      model: requestedModel,
      messages: OllamaProvider.normalizeMessages(messages),
      stream: false,
      tools: tools.length > 0 ? tools : undefined,
      options: forceCpu ? { num_gpu: 0 } : undefined
    };
    let res;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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
      const missingModel = OllamaProvider.parseMissingModelFromError(text);
      if (res.status === 404 && missingModel) {
        let fallbackModel = null;
        try {
          const knownModels = await this.listKnownModels();
          fallbackModel = OllamaProvider.pickFallbackModel(requestedModel, knownModels);
        } catch {
          fallbackModel = null;
        }
        if (fallbackModel && fallbackModel.toLowerCase() !== requestedModel.toLowerCase()) {
          const retryController = new AbortController();
          const retryTimer = setTimeout(() => retryController.abort(new Error('provider_timeout')), effectiveTimeout);
          try {
            const retry = await fetch(`${this.baseUrl}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: fallbackModel,
                messages: OllamaProvider.normalizeMessages(messages),
                stream: false,
                tools: tools.length > 0 ? tools : undefined,
                options: (forceCpu || /:cpu$/i.test(fallbackModel)) ? { num_gpu: 0 } : undefined
              }),
              signal: retryController.signal
            });
            if (retry.ok) {
              this.model = modelPrefix ? `${modelPrefix}/${fallbackModel}` : `ollama/${fallbackModel}`;
              const json = await retry.json();
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
            const retryText = await retry.text();
            throw new Error(`Ollama provider fallback failed (${fallbackModel}): ${retry.status} ${retryText}`);
          } catch (error) {
            if (error?.name === 'AbortError') {
              throw new Error(`Ollama provider timeout after ${effectiveTimeout}ms`);
            }
            throw error;
          } finally {
            clearTimeout(retryTimer);
          }
        }
      }
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
      reasoning: json?.message?.thinking || '',
      toolCalls
    };
  }

  async chatStream({ messages, tools = [], timeoutMs, onContentDelta, onReasoningDelta }) {
    const effectiveTimeout = Number.isFinite(timeoutMs)
      ? Math.max(1000, Number(timeoutMs))
      : this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), effectiveTimeout);
    const rawModel = String(this.model || '').trim();
    const modelPrefixMatch = rawModel.match(/^([a-z0-9-]+)\//i);
    const modelPrefix = modelPrefixMatch ? String(modelPrefixMatch[1] || '').toLowerCase() : '';
    const requestedModel = OllamaProvider.normalizeModelRef(rawModel);
    const forceCpu = modelPrefix === 'ollama-local' || /:cpu$/i.test(requestedModel);
    const requestBody = {
      model: requestedModel,
      messages: OllamaProvider.normalizeMessages(messages),
      stream: true,
      tools: tools.length > 0 ? tools : undefined,
      options: forceCpu ? { num_gpu: 0 } : undefined
    };
    let res;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      if (error?.name === 'AbortError') {
        throw new Error(`Ollama provider timeout after ${effectiveTimeout}ms`);
      }
      throw error;
    }
    if (!res.ok) {
      clearTimeout(timer);
      const text = await res.text();
      throw new Error(`Ollama provider stream failed: ${res.status} ${text}`);
    }

    clearTimeout(timer);

    const contentParts = [];
    const reasoningParts = [];
    const toolCalls = [];
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
          if (!trimmed) continue;
          let chunk;
          try { chunk = JSON.parse(trimmed); } catch { continue; }
          if (chunk.done) continue;

          if (chunk.message?.thinking) {
            reasoningParts.push(chunk.message.thinking);
            if (onReasoningDelta) onReasoningDelta(chunk.message.thinking);
          }
          if (chunk.message?.content) {
            contentParts.push(chunk.message.content);
            if (onContentDelta) onContentDelta(chunk.message.content);
          }
          if (Array.isArray(chunk.message?.tool_calls)) {
            for (const tc of chunk.message.tool_calls) {
              const idx = toolCalls.length;
              toolCalls.push({
                id: tc.id || `ollama-${idx}`,
                name: tc.function?.name,
                arguments: JSON.stringify(OllamaProvider.normalizeToolArguments(tc.function?.arguments))
              });
            }
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    return {
      content: contentParts.join(''),
      reasoning: reasoningParts.join(''),
      toolCalls
    };
  }
}
