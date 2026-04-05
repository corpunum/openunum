import { parseCommand, parseCommandWithFlags } from '../core/command-parser.mjs';
import { logInfo, logError, logWarn } from '../logger.mjs';

/**
 * Command Registry for OpenUnum
 * 
 * Central registry for all slash commands. Commands register themselves
 * with metadata (name, description, args, handler). The registry routes
 * incoming messages to the appropriate handler.
 */

export class CommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  /**
   * Register a command module
   * 
   * @param {object} cmd - Command definition
   * @param {string} cmd.name - Command name (lowercase, without /)
   * @param {string} cmd.description - Human-readable description
   * @param {Array} cmd.args - Argument definitions [{ name, required, description }]
   * @param {Function} cmd.execute - Handler: async (args, flags, context) => string|object
   * @param {string} cmd.source - Source module path (for debugging)
   */
  register(cmd) {
    if (!cmd.name || typeof cmd.execute !== 'function') {
      throw new Error('Command must have a name and execute function');
    }

    if (this.commands.has(cmd.name)) {
      logWarn('command_registry_override', { name: cmd.name, previous: this.commands.get(cmd.name).source });
    }

    this.commands.set(cmd.name, {
      name: cmd.name,
      description: cmd.description || '',
      args: cmd.args || [],
      execute: cmd.execute,
      source: cmd.source || 'unknown',
      examples: cmd.examples || []
    });

    logInfo('command_registered', { name: cmd.name, source: cmd.source });
  }

  /**
   * Check if a message is a command
   */
  isCommand(message) {
    return parseCommand(message) !== null;
  }

  /**
   * Route a message to the appropriate command handler
   * 
   * @param {string} message - Raw user message
   * @param {object} context - Execution context { sessionId, agent, memoryStore, config }
   * @returns {Promise<object|null>} - { handled, reply, commandName } or null if not a command
   */
  async route(message, context = {}) {
    const parsed = parseCommandWithFlags(message);
    if (!parsed) return null;

    const cmd = this.commands.get(parsed.name);
    if (!cmd) {
      // Unknown command — let the agent handle it as a fallback
      return {
        handled: false,
        commandName: parsed.name,
        error: `Unknown command: /${parsed.name}. Type /help for available commands.`
      };
    }

    try {
      logInfo('command_executing', { name: parsed.name, args: parsed.args, flags: parsed.flags });
      const result = await cmd.execute(parsed.args, parsed.flags, context);
      return {
        handled: true,
        commandName: parsed.name,
        reply: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        result
      };
    } catch (error) {
      logError('command_execution_error', { name: parsed.name, error: String(error.message || error) });
      return {
        handled: true,
        commandName: parsed.name,
        error: `Command /${parsed.name} failed: ${error.message || error}`
      };
    }
  }

  /**
   * List all registered commands
   */
  list() {
    return Array.from(this.commands.values()).map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      args: cmd.args
    }));
  }

  /**
   * Get a specific command definition
   */
  get(name) {
    return this.commands.get(name) || null;
  }
}

// Global singleton
let globalRegistry = null;

export function getRegistry() {
  if (!globalRegistry) {
    globalRegistry = new CommandRegistry();
  }
  return globalRegistry;
}

export default { CommandRegistry, getRegistry };
