/**
 * Tool Call Validator — Pre/Post Execution Validation for Weak Models
 * 
 * Validates tool calls before execution and results after execution.
 * Designed to catch common 9B model mistakes:
 * - Missing required arguments
 * - Invalid argument types
 * - Malformed JSON
 * - Dangerous operations without confirmation
 * 
 * Post-execution: validates results are sensible before accepting.
 */

import { logInfo, logError, logWarn } from '../logger.mjs';

// Tool schemas with required/optional args
const TOOL_SCHEMAS = {
  file_read: {
    required: ['path'],
    optional: ['offset', 'limit'],
    types: {
      path: 'string',
      offset: 'number',
      limit: 'number'
    }
  },
  file_write: {
    required: ['path', 'content'],
    optional: ['append'],
    types: {
      path: 'string',
      content: 'string',
      append: 'boolean'
    }
  },
  file_delete: {
    required: ['path'],
    optional: [],
    types: {
      path: 'string'
    },
    dangerous: true // Requires extra validation
  },
  shell_run: {
    required: ['command'],
    optional: ['timeout', 'workdir'],
    types: {
      command: 'string',
      timeout: 'number',
      workdir: 'string'
    },
    dangerous: true
  },
  web_search: {
    required: ['query'],
    optional: ['count', 'region'],
    types: {
      query: 'string',
      count: 'number',
      region: 'string'
    }
  },
  browser_navigate: {
    required: ['url'],
    optional: ['timeout'],
    types: {
      url: 'string',
      timeout: 'number'
    }
  },
  memory_recall: {
    required: ['query'],
    optional: ['limit', 'category'],
    types: {
      query: 'string',
      limit: 'number',
      category: 'string'
    }
  }
};

// Dangerous command patterns that need extra scrutiny
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i,
  /sudo\s+/i,
  /chmod\s+777/i,
  /dd\s+/i,
  /mkfs/i,
  /fork.*bomb/i,
  /curl.*\|.*bash/i,
  /wget.*\|.*sh/i
];

export class ToolValidator {
  constructor({ config }) {
    this.config = config;
    this.validationStats = {
      totalValidated: 0,
      preExecutionFailures: 0,
      postExecutionFailures: 0,
      autoCorrected: 0
    };
  }

  /**
   * Pre-execution validation
   * 
   * @param {string} toolName - Tool being called
   * @param {object} args - Arguments provided
   * @returns {{valid: boolean, errors: string[], correctedArgs?: object}}
   */
  validatePreExecution(toolName, args) {
    this.validationStats.totalValidated++;
    
    const errors = [];
    const schema = TOOL_SCHEMAS[toolName];
    
    if (!schema) {
      logWarn('tool_validator_unknown_tool', { toolName });
      return { valid: true, errors: [] }; // Allow unknown tools through
    }

    // Check required arguments
    for (const requiredArg of schema.required) {
      if (args[requiredArg] === undefined || args[requiredArg] === null) {
        errors.push(`Missing required argument: ${requiredArg}`);
      }
    }

    // Check argument types
    for (const [argName, expectedType] of Object.entries(schema.types)) {
      if (args[argName] !== undefined && typeof args[argName] !== expectedType) {
        errors.push(`Argument ${argName} should be ${expectedType}, got ${typeof args[argName]}`);
      }
    }

    // Dangerous tool extra validation
    if (schema.dangerous) {
      const dangerousErrors = this._checkDangerousOperation(toolName, args);
      errors.push(...dangerousErrors);
    }

    // Auto-correction attempts
    const correctedArgs = this._tryAutoCorrect(toolName, args, schema);

    const valid = errors.length === 0;
    if (!valid) {
      this.validationStats.preExecutionFailures++;
      logError('tool_validator_pre_exec_failed', {
        toolName,
        errors,
        argsProvided: args
      });
    }

    return {
      valid,
      errors,
      correctedArgs: correctedArgs && correctedArgs !== args ? correctedArgs : undefined
    };
  }

  /**
   * Check for dangerous operations
   */
  _checkDangerousOperation(toolName, args) {
    const errors = [];

    if (toolName === 'shell_run' && typeof args.command === 'string') {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(args.command)) {
          errors.push(`Dangerous command pattern detected: ${pattern.source}`);
        }
      }
    }

    if (toolName === 'file_delete' && typeof args.path === 'string') {
      // Prevent deleting critical paths
      const criticalPaths = ['/', '/home', '/etc', '/usr', '/var', '/proc', '/sys'];
      for (const critical of criticalPaths) {
        if (args.path === critical || args.path.startsWith(critical + '/')) {
          errors.push(`Cannot delete critical system path: ${args.path}`);
        }
      }
    }

    return errors;
  }

  /**
   * Try to auto-correct common mistakes
   */
  _tryAutoCorrect(toolName, args, schema) {
    const corrected = { ...args };
    let madeCorrection = false;

    // Auto-add missing optional args with defaults
    if (toolName === 'web_search' && corrected.count === undefined) {
      corrected.count = 5;
      madeCorrection = true;
    }

    if (toolName === 'memory_recall' && corrected.limit === undefined) {
      corrected.limit = 5;
      madeCorrection = true;
    }

    if (toolName === 'file_read' && corrected.offset === undefined) {
      corrected.offset = 1;
      madeCorrection = true;
    }

    // Fix common type mistakes
    if (schema.types?.count === 'number' && typeof corrected.count === 'string') {
      const parsed = parseInt(corrected.count, 10);
      if (!isNaN(parsed)) {
        corrected.count = parsed;
        madeCorrection = true;
      }
    }

    if (schema.types?.limit === 'number' && typeof corrected.limit === 'string') {
      const parsed = parseInt(corrected.limit, 10);
      if (!isNaN(parsed)) {
        corrected.limit = parsed;
        madeCorrection = true;
      }
    }

    if (madeCorrection) {
      this.validationStats.autoCorrected++;
      logInfo('tool_validator_auto_corrected', { toolName, corrections: corrected });
    }

    return madeCorrection ? corrected : args;
  }

  /**
   * Post-execution validation
   * 
   * @param {string} toolName - Tool that was called
   * @param {object} args - Arguments that were used
   * @param {object} result - Result from tool execution
   * @returns {{valid: boolean, warnings: string[], shouldRetry: boolean}}
   */
  validatePostExecution(toolName, args, result) {
    const warnings = [];
    let shouldRetry = false;

    // Check for error results
    if (result?.error) {
      warnings.push(`Tool returned error: ${result.error}`);
      shouldRetry = true;
    }

    // Check for empty/unexpected results
    if (toolName === 'file_read' && !result?.content) {
      warnings.push('File read returned empty content');
    }

    if (toolName === 'web_search' && (!result?.results || result.results.length === 0)) {
      warnings.push('Web search returned no results');
    }

    if (toolName === 'memory_recall' && (!result?.memories || result.memories.length === 0)) {
      warnings.push('Memory recall returned no results');
    }

    // Check result sanity
    if (toolName === 'shell_run' && result?.code !== 0 && result?.code !== undefined) {
      warnings.push(`Shell command exited with code ${result.code}`);
    }

    if (result?.ok === false) {
      warnings.push('Tool reported ok=false');
      shouldRetry = true;
    }

    if (warnings.length > 0) {
      this.validationStats.postExecutionFailures++;
      logWarn('tool_validator_post_exec_warnings', {
        toolName,
        warnings,
        result
      });
    }

    return {
      valid: warnings.length === 0,
      warnings,
      shouldRetry
    };
  }

  /**
   * Get validation stats (for debugging/API)
   */
  getStats() {
    return {
      ...this.validationStats,
      successRate: this.validationStats.totalValidated > 0
        ? 1 - (this.validationStats.preExecutionFailures / this.validationStats.totalValidated)
        : 1
    };
  }

  /**
   * Reset stats
   */
  resetStats() {
    this.validationStats = {
      totalValidated: 0,
      preExecutionFailures: 0,
      postExecutionFailures: 0,
      autoCorrected: 0
    };
  }
}

/**
 * Validate tool call and return formatted error message if invalid
 */
export function validateToolCall(validator, toolName, args) {
  const result = validator.validatePreExecution(toolName, args);
  
  if (!result.valid) {
    const errorMsg = `Tool call validation failed for ${toolName}:\n` +
      result.errors.map(e => `  - ${e}`).join('\n');
    
    if (result.correctedArgs) {
      return {
        valid: true,
        args: result.correctedArgs,
        note: 'Arguments were auto-corrected'
      };
    }
    
    return {
      valid: false,
      error: errorMsg
    };
  }
  
  return {
    valid: true,
    args: result.correctedArgs || args
  };
}
