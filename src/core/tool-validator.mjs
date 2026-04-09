/**
 * Tool Validator
 * Pre-execution validation delegates to preflight-validator (single source of truth).
 */

import { validateToolCall as validatePreflightToolCall, getValidatedTools } from './preflight-validator.mjs';

export class ToolValidator {
  constructor({ config } = {}) {
    this.config = config || {};
    this.validationStats = {
      totalValidated: 0,
      preExecutionFailures: 0,
      postExecutionFailures: 0
    };
  }

  validatePreExecution(toolName, args) {
    this.validationStats.totalValidated += 1;
    const out = validatePreflightToolCall(toolName, args);
    if (!out.valid) this.validationStats.preExecutionFailures += 1;
    return {
      valid: Boolean(out.valid),
      errors: out.valid ? [] : [String(out.hint || 'preflight_validation_failed')],
      correctedArgs: undefined
    };
  }

  validatePostExecution(toolName, args, result) {
    const warnings = [];
    let shouldRetry = false;

    if (result?.error) {
      warnings.push(`Tool returned error: ${result.error}`);
      shouldRetry = true;
    }
    if (toolName === 'file_read' && typeof result?.content !== 'string') {
      warnings.push('file_read did not return string content');
    }
    if (toolName === 'web_search' && !Array.isArray(result?.results)) {
      warnings.push('web_search did not return results array');
    }
    if (toolName === 'classify' && !result?.data?.label) {
      warnings.push('classify did not return label');
    }
    if (warnings.length > 0) this.validationStats.postExecutionFailures += 1;
    return { valid: warnings.length === 0, warnings, shouldRetry };
  }

  getStats() {
    return {
      ...this.validationStats,
      validatedTools: getValidatedTools(),
      successRate: this.validationStats.totalValidated > 0
        ? 1 - (this.validationStats.preExecutionFailures / this.validationStats.totalValidated)
        : 1
    };
  }

  resetStats() {
    this.validationStats = {
      totalValidated: 0,
      preExecutionFailures: 0,
      postExecutionFailures: 0
    };
  }
}

export function validateToolCall(validator, toolName, args) {
  if (!validator || typeof validator.validatePreExecution !== 'function') {
    const out = validatePreflightToolCall(toolName, args);
    return out.valid ? { valid: true, args } : { valid: false, error: String(out.hint || 'preflight_validation_failed') };
  }
  const result = validator.validatePreExecution(toolName, args);
  if (!result.valid) {
    return {
      valid: false,
      error: `Tool call validation failed for ${toolName}: ${(result.errors || []).join('; ')}`
    };
  }
  return { valid: true, args: result.correctedArgs || args };
}

