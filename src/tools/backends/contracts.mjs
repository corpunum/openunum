function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export const MODEL_BACKED_TOOL_CONTRACTS = {
  summarize: {
    name: 'summarize',
    purpose: 'Summarize input text into a concise output.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        maxChars: { type: 'number' },
        style: { type: 'string' }
      },
      required: ['text']
    },
    outputSchema: {
      requiredDataFields: ['summary'],
      confidenceMin: 0.0
    },
    sideEffects: 'none',
    resourceClass: 'compact'
  },
  classify: {
    name: 'classify',
    purpose: 'Classify input text against a provided label set.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        topK: { type: 'number' }
      },
      required: ['text', 'labels']
    },
    outputSchema: {
      requiredDataFields: ['label', 'reason'],
      confidenceMin: 0.0
    },
    sideEffects: 'none',
    resourceClass: 'compact'
  }
};

export function buildModelBackedToolSchemas({ exposeToController = true } = {}) {
  if (!exposeToController) return [];
  return Object.values(MODEL_BACKED_TOOL_CONTRACTS).map((contract) => ({
    type: 'function',
    function: {
      name: contract.name,
      description: contract.purpose,
      parameters: contract.parameters
    }
  }));
}

export function normalizeModelBackedOutput(toolName, raw = {}, backendInfo = {}) {
  const contract = MODEL_BACKED_TOOL_CONTRACTS[toolName];
  if (!contract) {
    return { ok: false, error: 'unknown_model_backed_tool_contract', tool: toolName };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'validation_failed', tool: toolName, details: 'backend output is not an object' };
  }
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  const missing = (contract.outputSchema?.requiredDataFields || []).filter((field) => {
    const value = data[field];
    return value === undefined || value === null || value === '';
  });
  if (missing.length > 0) {
    return {
      ok: false,
      error: 'validation_failed',
      tool: toolName,
      details: `missing required output fields: ${missing.join(', ')}`
    };
  }
  return {
    ok: raw.ok !== false,
    tool: toolName,
    data,
    confidence: clamp01(raw.confidence, 0),
    backend: {
      type: String(backendInfo?.type || 'model'),
      id: String(backendInfo?.id || ''),
      provider: String(backendInfo?.provider || ''),
      model: String(backendInfo?.model || '')
    },
    validation: {
      schemaOk: true,
      contractOk: true
    }
  };
}

