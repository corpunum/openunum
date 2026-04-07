// Canonical internal tool-call schema
export const ToolCallDTO = {
  create({ id, name, arguments: args }) {
    return {
      id: id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      arguments: typeof args === 'string' ? JSON.parse(args) : args,
      timestamp: new Date().toISOString()
    };
  },

  validate(dto) {
    const errors = [];
    if (!dto.id) errors.push('missing id');
    if (!dto.name) errors.push('missing name');
    if (dto.arguments === undefined) errors.push('missing arguments');
    return { valid: errors.length === 0, errors };
  },

  toOllama(dto) {
    return { function: { name: dto.name, arguments: dto.arguments } };
  },

  toOpenAI(dto) {
    return { id: dto.id, type: 'function', function: { name: dto.name, arguments: JSON.stringify(dto.arguments) } };
  },

  fromOllama(raw) {
    return ToolCallDTO.create({ name: raw.function?.name, arguments: raw.function?.arguments });
  },

  fromOpenAI(raw) {
    return ToolCallDTO.create({ id: raw.id, name: raw.function?.name, arguments: raw.function?.arguments });
  }
};

// Result DTO
export const ToolResultDTO = {
  create({ toolCallId, name, result, error }) {
    return {
      toolCallId,
      name,
      result: result || null,
      error: error || null,
      timestamp: new Date().toISOString(),
      success: !error
    };
  },

  validate(dto) {
    const errors = [];
    if (!dto.toolCallId) errors.push('missing toolCallId');
    if (!dto.name) errors.push('missing name');
    return { valid: errors.length === 0, errors };
  }
};
