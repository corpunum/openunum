import { getOAuthApiKey } from '@mariozechner/pi-ai/oauth';
import { streamSimpleOpenAICodexResponses } from '@mariozechner/pi-ai';
import { getEffectiveOpenAICodexOAuthStatus, getStoredOpenAICodexOAuth, saveOpenAICodexOAuth } from '../secrets/store.mjs';

const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api';

function parseToolArgs(rawArgs) {
  if (rawArgs == null) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  if (typeof rawArgs !== 'string') return {};
  try {
    return JSON.parse(rawArgs || '{}');
  } catch {
    return {};
  }
}

function nowPlusOneHour() {
  return Date.now() + 60 * 60 * 1000;
}

function normalizeMessages(messages = []) {
  const systemParts = [];
  const contextMessages = [];
  const toolNames = new Map();

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role === 'system') {
      const text = String(msg.content || '').trim();
      if (text) systemParts.push(text);
      continue;
    }

    if (msg.role === 'user') {
      contextMessages.push({
        role: 'user',
        content: String(msg.content || ''),
        timestamp: Date.now()
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const content = [];
      const text = String(msg.content || '');
      if (text) content.push({ type: 'text', text });
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (const tc of toolCalls) {
        const callId = String(tc?.id || '').trim();
        const name = String(tc?.function?.name || tc?.name || '').trim();
        if (!callId || !name) continue;
        toolNames.set(callId, name);
        content.push({
          type: 'toolCall',
          id: callId,
          name,
          arguments: parseToolArgs(tc?.function?.arguments ?? tc?.arguments ?? '{}')
        });
      }
      if (content.length > 0) {
        contextMessages.push({
          role: 'assistant',
          content,
          api: 'openai-codex-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: 'stop',
          timestamp: Date.now()
        });
      }
      continue;
    }

    if (msg.role === 'tool') {
      contextMessages.push({
        role: 'toolResult',
        toolCallId: String(msg.tool_call_id || ''),
        toolName: toolNames.get(String(msg.tool_call_id || '')) || 'tool',
        content: [{ type: 'text', text: String(msg.content || '') }],
        isError: Boolean(parseToolArgs(msg.content)?.ok === false),
        timestamp: Date.now()
      });
    }
  }

  return {
    systemPrompt: systemParts.join('\n\n').trim() || undefined,
    messages: contextMessages
  };
}

function buildModelSpec(model) {
  const modelId = String(model || '').replace(/^(generic|openai)\//, '');
  return {
    id: modelId,
    name: modelId,
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    baseUrl: OPENAI_CODEX_BASE_URL,
    reasoning: /^gpt-5/.test(modelId) || /codex/i.test(modelId),
    input: ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: 262144,
    maxTokens: 32768
  };
}

function normalizeTools(tools = []) {
  return tools
    .map((tool) => {
      if (tool?.name && tool?.parameters) return tool;
      if (tool?.function?.name && tool?.function?.parameters) {
        return {
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: tool.function.parameters
        };
      }
      return null;
    })
    .filter(Boolean);
}

export class OpenAICodexOAuthProvider {
  constructor({
    model,
    timeoutMs = 120000,
    getOAuthApiKeyFn = getOAuthApiKey,
    saveCredentialsFn = saveOpenAICodexOAuth,
    streamFn = streamSimpleOpenAICodexResponses
  }) {
    this.model = model;
    this.timeoutMs = Number.isFinite(timeoutMs) ? Number(timeoutMs) : 120000;
    this.getOAuthApiKeyFn = getOAuthApiKeyFn;
    this.saveCredentialsFn = saveCredentialsFn;
    this.streamFn = streamFn;
  }

  async resolveApiKey() {
    const stored = getStoredOpenAICodexOAuth();
    const effective = getEffectiveOpenAICodexOAuthStatus().active;
    const credentials = stored || effective;
    if (!credentials) {
      throw new Error('OpenAI Codex OAuth is not configured');
    }
    const resolved = await this.getOAuthApiKeyFn('openai-codex', {
      'openai-codex': {
        access: credentials.access,
        refresh: credentials.refresh,
        expires: Number(credentials.expires || 0) || 0,
        accountId: String(credentials.accountId || '').trim()
      }
    });
    if (!resolved?.apiKey) {
      throw new Error('OpenAI Codex OAuth could not produce an API token');
    }
    if (resolved.newCredentials) {
      this.saveCredentialsFn({
        access: resolved.newCredentials.access,
        refresh: resolved.newCredentials.refresh,
        expires: Number(resolved.newCredentials.expires || 0) || nowPlusOneHour(),
        accountId: String(resolved.newCredentials.accountId || credentials.accountId || '').trim(),
        email: String(credentials.email || '').trim(),
        source: String(credentials.source || 'openunum').trim()
      });
    }
    return resolved.apiKey;
  }

  async chat({ messages, tools = [], timeoutMs }) {
    const effectiveTimeout = Number.isFinite(timeoutMs)
      ? Math.max(1000, Number(timeoutMs))
      : this.timeoutMs;
    const apiKey = await this.resolveApiKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), effectiveTimeout);
    try {
      const model = buildModelSpec(this.model);
      const context = {
        ...normalizeMessages(messages),
        tools: normalizeTools(tools)
      };
      const stream = this.streamFn(model, context, {
        apiKey,
        signal: controller.signal,
        reasoning: /^gpt-5/.test(model.id) ? 'high' : 'medium',
        transport: 'sse'
      });
      const output = await stream.result();
      if (!output || output.stopReason === 'error' || output.stopReason === 'aborted') {
        throw new Error(output?.errorMessage || `OpenAI Codex OAuth provider ${output?.stopReason || 'failed'}`);
      }
      const content = Array.isArray(output.content)
        ? output.content
          .filter((item) => item?.type === 'text')
          .map((item) => item.text || '')
          .join('\n')
          .trim()
        : '';
      const toolCalls = Array.isArray(output.content)
        ? output.content
          .filter((item) => item?.type === 'toolCall')
          .map((item) => ({
            id: item.id,
            name: item.name,
            arguments: JSON.stringify(item.arguments || {})
          }))
        : [];
      return { content, toolCalls };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`OpenAI Codex OAuth provider timeout after ${effectiveTimeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
