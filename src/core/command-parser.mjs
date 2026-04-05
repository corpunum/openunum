#!/usr/bin/env node
/**
 * Channel-Agnostic Command Parser for OpenUnum
 * 
 * Parses `/cmd [args]` syntax from any channel (WebUI, Telegram, CLI, etc.)
 * Returns structured command objects for the command registry to route.
 */

/**
 * Parse a command from user input
 * 
 * @param {string} message - Raw user message
 * @returns {object|null} - { name, args, raw, isCommand } or null if not a command
 */
export function parseCommand(message) {
  const text = String(message || '').trim();
  
  // Only parse lines starting with / at message start
  if (!text.startsWith('/')) {
    return null;
  }

  // Extract command name and args
  const [command, ...rest] = text.slice(1).split(/\s+/);
  
  return {
    name: String(command || '').toLowerCase(),
    args: rest,
    raw: text,
    isCommand: true
  };
}

/**
 * Parse command with argument flags (e.g., /compact --dry-run)
 * 
 * @param {string} message - Raw user message
 * @returns {object|null} - { name, args, flags, raw, isCommand } or null
 */
export function parseCommandWithFlags(message) {
  const parsed = parseCommand(message);
  if (!parsed) return null;

  const args = [];
  const flags = {};

  for (const arg of parsed.args) {
    if (arg.startsWith('--')) {
      // Flag like --dry-run or --key=value
      const [key, value] = arg.slice(2).split('=');
      flags[key] = value === undefined ? true : value;
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Short flag like -v
      flags[arg.slice(1)] = true;
    } else {
      // Positional argument
      args.push(arg);
    }
  }

  return {
    ...parsed,
    args,
    flags,
    isCommand: true
  };
}

/**
 * Validate command syntax
 * 
 * @param {object} cmd - Parsed command object
 * @returns {object} - { valid, errors }
 */
export function validateCommand(cmd) {
  const errors = [];

  if (!cmd.name || cmd.name.length === 0) {
    errors.push('Command name is required');
  }

  if (!/^[a-z][a-z0-9_-]*$/.test(cmd.name)) {
    errors.push(`Invalid command name: ${cmd.name} (must be lowercase alphanumeric with - or _)`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Format command for display (help text)
 * 
 * @param {object} cmd - Command definition
 * @returns {string} - Formatted help string
 */
export function formatCommandHelp(cmd) {
  const { name, description, args = [], examples = [] } = cmd;
  
  let output = `/${name}`;
  
  if (args.length > 0) {
    const argStr = args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ');
    output += ` ${argStr}`;
  }
  
  if (description) {
    output += `\n  ${description}`;
  }
  
  if (examples.length > 0) {
    output += '\n  Examples:';
    examples.forEach(ex => {
      output += `\n    /${name} ${ex}`;
    });
  }
  
  return output;
}

export default {
  parseCommand,
  parseCommandWithFlags,
  validateCommand,
  formatCommandHelp
};
