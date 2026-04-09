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
  },
  extract: {
    name: 'extract',
    purpose: 'Extract structured fields from input text.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        fields: { type: 'array', items: { type: 'string' } }
      },
      required: ['text', 'fields']
    },
    outputSchema: {
      requiredDataFields: ['fields'],
      confidenceMin: 0.0
    },
    sideEffects: 'none',
    resourceClass: 'compact'
  },
  parse_function_args: {
    name: 'parse_function_args',
    purpose: 'Parse function arguments from natural language into a normalized JSON object.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        targetFunction: { type: 'string' },
        availableArgs: { type: 'array', items: { type: 'string' } }
      },
      required: ['text']
    },
    outputSchema: {
      requiredDataFields: ['arguments'],
      confidenceMin: 0.0
    },
    sideEffects: 'none',
    resourceClass: 'compact'
  },
  embed_text: {
    name: 'embed_text',
    purpose: 'Generate a lightweight numeric embedding vector for input text.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        dimensions: { type: 'number' }
      },
      required: ['text']
    },
    outputSchema: {
      requiredDataFields: ['embedding'],
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
  if (toolName === 'parse_function_args') {
    const argsOut = data.arguments;
    if (!argsOut || typeof argsOut !== 'object' || Array.isArray(argsOut)) {
      return {
        ok: false,
        error: 'validation_failed',
        tool: toolName,
        details: 'arguments must be an object'
      };
    }
  }
  if (toolName === 'embed_text') {
    const embedding = data.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0 || !embedding.every((v) => Number.isFinite(Number(v)))) {
      return {
        ok: false,
        error: 'validation_failed',
        tool: toolName,
        details: 'embedding must be a non-empty numeric array'
      };
    }
    data.embedding = embedding.map((v) => Number(v));
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
