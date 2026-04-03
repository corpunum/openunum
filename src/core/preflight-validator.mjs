/**
 * Pre-Flight Tool Validator
 * Catches bad tool arguments before execution.
 * Saves turns — especially critical for small models.
 */

const TOOL_VALIDATORS = {
  file_read: (args) => {
    if (!args || !args.path) return { valid: false, hint: 'Missing required "path" argument. Example: { "path": "/tmp/file.txt" }' };
    if (typeof args.path !== 'string') return { valid: false, hint: '"path" must be a string' };
    if (args.path.length > 4096) return { valid: false, hint: '"path" is too long' };
    return { valid: true };
  },

  file_write: (args) => {
    if (!args || !args.path) return { valid: false, hint: 'Missing required "path" argument' };
    if (typeof args.path !== 'string') return { valid: false, hint: '"path" must be a string' };
    if (args.content === undefined) return { valid: false, hint: 'Missing required "content" argument' };
    return { valid: true };
  },

  file_patch: (args) => {
    if (!args || !args.path) return { valid: false, hint: 'Missing required "path" argument' };
    if (args.find === undefined) return { valid: false, hint: 'Missing required "find" argument' };
    if (args.replace === undefined) return { valid: false, hint: 'Missing required "replace" argument' };
    return { valid: true };
  },

  shell_run: (args) => {
    if (!args || !args.cmd) return { valid: false, hint: 'Missing required "cmd" argument. Example: { "cmd": "ls -la" }' };
    if (typeof args.cmd !== 'string') return { valid: false, hint: '"cmd" must be a string' };
    if (args.cmd.length === 0) return { valid: false, hint: '"cmd" cannot be empty' };
    if (args.cmd.length > 50000) return { valid: false, hint: '"cmd" too long — break into smaller steps' };
    return { valid: true };
  },

  http_request: (args) => {
    if (!args || !args.url) return { valid: false, hint: 'Missing required "url" argument. Example: { "url": "https://example.com" }' };
    if (typeof args.url !== 'string') return { valid: false, hint: '"url" must be a string' };
    try { new URL(args.url); } catch { return { valid: false, hint: `"url" is not valid: ${args.url}` }; }
    if (args.method && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(args.method.toUpperCase())) {
      return { valid: false, hint: `"method" must be one of GET/POST/PUT/PATCH/DELETE` };
    }
    return { valid: true };
  },

  http_download: (args) => {
    if (!args || !args.url) return { valid: false, hint: 'Missing required "url" argument' };
    if (!args.outPath) return { valid: false, hint: 'Missing required "outPath" argument' };
    try { new URL(args.url); } catch { return { valid: false, hint: '"url" is not valid' }; }
    return { valid: true };
  },

  browser_navigate: (args) => {
    if (!args || !args.url) return { valid: false, hint: 'Missing required "url" argument' };
    try { new URL(args.url); } catch { return { valid: false, hint: '"url" is not valid' }; }
    return { valid: true };
  },

  browser_type: (args) => {
    if (!args || !args.selector) return { valid: false, hint: 'Missing required "selector" argument' };
    if (args.text === undefined) return { valid: false, hint: 'Missing required "text" argument' };
    return { valid: true };
  },

  browser_click: (args) => {
    if (!args || !args.selector) return { valid: false, hint: 'Missing required "selector" argument' };
    return { valid: true };
  },

  browser_extract: (args) => {
    // selector is optional for extract
    return { valid: true };
  },

  browser_search: (args) => {
    if (!args || !args.query) return { valid: false, hint: 'Missing required "query" argument' };
    return { valid: true };
  },

  email_send: (args) => {
    if (!args || !args.to) return { valid: false, hint: 'Missing required "to" argument' };
    if (!args.subject) return { valid: false, hint: 'Missing required "subject" argument' };
    if (!args.body) return { valid: false, hint: 'Missing required "body" argument' };
    return { valid: true };
  },

  email_read: (args) => {
    if (!args || !args.id) return { valid: false, hint: 'Missing required "id" argument' };
    return { valid: true };
  },

  skill_execute: (args) => {
    if (!args || !args.name) return { valid: false, hint: 'Missing required "name" argument' };
    return { valid: true };
  },

  skill_install: (args) => {
    if (!args || (!args.source && !args.content)) {
      return { valid: false, hint: 'Missing required "source" or "content" argument' };
    }
    return { valid: true };
  },

  skill_review: (args) => {
    if (!args || !args.name) return { valid: false, hint: 'Missing required "name" argument' };
    return { valid: true };
  },

  skill_approve: (args) => {
    if (!args || !args.name) return { valid: false, hint: 'Missing required "name" argument' };
    return { valid: true };
  },

  skill_uninstall: (args) => {
    if (!args || !args.name) return { valid: false, hint: 'Missing required "name" argument' };
    return { valid: true };
  },

  session_delete: (args) => {
    if (!args || !args.sessionId) return { valid: false, hint: 'Missing required "sessionId" argument' };
    return { valid: true };
  },

  gworkspace_call: (args) => {
    if (!args || !args.service) return { valid: false, hint: 'Missing required "service" argument' };
    if (!args.resource) return { valid: false, hint: 'Missing required "resource" argument' };
    if (!args.method) return { valid: false, hint: 'Missing required "method" argument' };
    return { valid: true };
  },

  desktop_open: (args) => {
    if (!args || !args.target) return { valid: false, hint: 'Missing required "target" argument' };
    return { valid: true };
  },

  desktop_xdotool: (args) => {
    if (!args || !args.cmd) return { valid: false, hint: 'Missing required "cmd" argument' };
    return { valid: true };
  }
};

/**
 * Validate a tool call before execution.
 * @returns {{ valid: boolean, hint?: string }}
 */
export function validateToolCall(toolName, args) {
  const validator = TOOL_VALIDATORS[toolName];
  if (!validator) return { valid: true }; // Unknown tool — let it through
  return validator(args);
}

/**
 * Get list of all validated tools (for diagnostics)
 */
export function getValidatedTools() {
  return Object.keys(TOOL_VALIDATORS);
}
