/**
 * Pre-Flight Tool Validator
 * Single source of truth driven by tool contracts.
 */

import { toolDefinitions as fileSearchTools } from '../tools/file-search.mjs';
import { toolDefinitions as webSearchTools } from '../tools/web-search.mjs';
import { buildCoreToolSchemas, buildValidationIndex } from '../tools/tool-contracts.mjs';
import { buildModelBackedToolSchemas } from '../tools/backends/contracts.mjs';

const EXTRA_SCHEMAS = [
  ...Object.entries(fileSearchTools).map(([name, def]) => ({
    type: 'function',
    function: { name, parameters: def.parameters || { type: 'object' } }
  })),
  ...Object.entries(webSearchTools).map(([name, def]) => ({
    type: 'function',
    function: { name, parameters: def.parameters || { type: 'object' } }
  })),
  ...buildModelBackedToolSchemas({ exposeToController: true })
];

const TOOL_VALIDATION_INDEX = buildValidationIndex([...buildCoreToolSchemas(), ...EXTRA_SCHEMAS]);

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

function addTypeError(errors, field, expected) {
  errors.push(`${field} must be ${expected}`);
}

function genericValidate(name, args, spec) {
  const errors = [];
  for (const required of spec.required || []) {
    if (args[required] === undefined || args[required] === null || args[required] === '') {
      errors.push(`Missing required "${required}" argument`);
    }
  }
  for (const [field, expected] of Object.entries(spec.types || {})) {
    if (args[field] === undefined || args[field] === null) continue;
    if (expected === 'array') {
      if (!Array.isArray(args[field])) addTypeError(errors, field, 'array');
      continue;
    }
    if (expected === 'number') {
      if (typeof args[field] !== 'number' || !Number.isFinite(args[field])) addTypeError(errors, field, 'number');
      continue;
    }
    if (typeof args[field] !== expected) addTypeError(errors, field, expected);
  }
  if (name === 'shell_run' && typeof args.cmd === 'string') {
    const matched = DANGEROUS_PATTERNS.find((pattern) => pattern.test(args.cmd));
    if (matched) errors.push(`Dangerous command pattern detected: ${matched.source}`);
  }
  if (name === 'http_request' && typeof args.url === 'string') {
    try {
      const u = new URL(args.url);
      if (!/^https?:$/i.test(u.protocol)) errors.push('url must be http(s)');
    } catch {
      errors.push(`"url" is not valid: ${args.url}`);
    }
  }
  if (name === 'http_download' && typeof args.url === 'string') {
    try {
      const u = new URL(args.url);
      if (!/^https?:$/i.test(u.protocol)) errors.push('url must be http(s)');
    } catch {
      errors.push(`"url" is not valid: ${args.url}`);
    }
  }
  if (name === 'classify' && Array.isArray(args.labels) && args.labels.length < 2) {
    errors.push('"labels" should include at least two candidates');
  }
  if (name === 'extract' && Array.isArray(args.fields) && args.fields.length < 1) {
    errors.push('"fields" should include at least one field name');
  }
  return errors;
}

/**
 * Validate a tool call before execution.
 * @returns {{ valid: boolean, hint?: string }}
 */
export function validateToolCall(toolName, args) {
  const name = String(toolName || '').trim();
  const currentArgs = args && typeof args === 'object' ? args : {};
  const spec = TOOL_VALIDATION_INDEX[name];
  if (!spec) return { valid: true };
  const errors = genericValidate(name, currentArgs, spec);
  if (!errors.length) return { valid: true };
  return { valid: false, hint: errors[0], errors };
}

export function getValidatedTools() {
  return Object.keys(TOOL_VALIDATION_INDEX);
}
