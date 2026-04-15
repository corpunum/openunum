import { getRegistry } from './registry.mjs';
import helpCommand from './builtin/help.mjs';
import startCommand from './builtin/start.mjs';
import statusCommand from './builtin/status.mjs';
import newCommand from './builtin/new.mjs';
import compactCommand from './builtin/compact.mjs';
import memoryCommand from './builtin/memory.mjs';
import ledgerCommand from './builtin/ledger.mjs';
import costCommand from './builtin/cost.mjs';
import sessionCommand from './builtin/session.mjs';
import ruleCommand from './builtin/rule.mjs';
import knowledgeCommand from './builtin/knowledge.mjs';
import skillCommand from './builtin/skill.mjs';
import { logInfo } from '../logger.mjs';

/**
 * Load all builtin commands into the global registry
 */
export function loadBuiltinCommands() {
  const registry = getRegistry();

  const builtins = [
    helpCommand,
    startCommand,
    statusCommand,
    newCommand,
    compactCommand,
    memoryCommand,
    ledgerCommand,
    costCommand,
    sessionCommand,
    ruleCommand,
    knowledgeCommand,
    skillCommand
  ];

  for (const cmd of builtins) {
    registry.register(cmd);
  }

  logInfo('builtin_commands_loaded', { count: builtins.length });
  return registry;
}

export default { loadBuiltinCommands };
