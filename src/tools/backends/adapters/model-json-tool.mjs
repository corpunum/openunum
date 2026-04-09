import { buildProviderForModel } from '../../../providers/index.mjs';

function safeParseJsonObject(text = '') {
  const source = String(text || '').trim();
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(source.slice(start, end + 1));
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildPrompt(toolName, args = {}) {
  if (toolName === 'summarize') {
    return [
      'You are a strict JSON tool backend for summarize.',
      'Return only valid JSON with shape: {"data":{"summary":"..."},"confidence":0.0}.',
      `text: ${String(args.text || '')}`,
      `maxChars: ${Number.isFinite(args.maxChars) ? Number(args.maxChars) : 240}`,
      `style: ${String(args.style || 'concise')}`
    ].join('\n');
  }
  if (toolName === 'classify') {
    const labels = Array.isArray(args.labels) ? args.labels.map((x) => String(x || '').trim()).filter(Boolean) : [];
    return [
      'You are a strict JSON tool backend for classify.',
      'Return only valid JSON with shape: {"data":{"label":"...","reason":"..."},"confidence":0.0}.',
      `text: ${String(args.text || '')}`,
      `labels: ${JSON.stringify(labels)}`,
      `topK: ${Number.isFinite(args.topK) ? Number(args.topK) : 1}`
    ].join('\n');
  }
  if (toolName === 'extract') {
    const fields = Array.isArray(args.fields) ? args.fields.map((x) => String(x || '').trim()).filter(Boolean) : [];
    return [
      'You are a strict JSON tool backend for extract.',
      'Return only valid JSON with shape: {"data":{"fields":{"field":"value"}},"confidence":0.0}.',
      `text: ${String(args.text || '')}`,
      `fields: ${JSON.stringify(fields)}`
    ].join('\n');
  }
  return [
    `You are a strict JSON tool backend for ${toolName}.`,
    'Return only valid JSON with shape: {"data":{},"confidence":0.0}.',
    `args: ${JSON.stringify(args || {})}`
  ].join('\n');
}

export async function executeModelJsonTool({ config, toolName, args = {}, profile }) {
  const provider = buildProviderForModel(config, {
    provider: profile.provider,
    model: profile.model,
    timeoutMs: profile.timeoutMs
  });
  const out = await provider.chat({
    messages: [
      { role: 'system', content: 'Output valid JSON only. Do not add markdown.' },
      { role: 'user', content: buildPrompt(toolName, args) }
    ],
    tools: [],
    timeoutMs: profile.timeoutMs
  });
  const parsed = safeParseJsonObject(String(out?.content || ''));
  if (!parsed) {
    return {
      ok: false,
      error: 'validation_failed',
      details: 'model returned non-JSON output'
    };
  }
  return {
    ok: parsed.ok !== false,
    data: parsed.data && typeof parsed.data === 'object' ? parsed.data : {},
    confidence: Number(parsed.confidence)
  };
}
