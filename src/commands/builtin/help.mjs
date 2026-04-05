import { getRegistry } from '../registry.mjs';

export const helpCommand = {
  name: 'help',
  description: 'Show available commands or details for a specific command',
  args: [
    { name: 'command', required: false, description: 'Command name to get help for' }
  ],
  source: 'builtin/help.mjs',
  examples: ['help', 'help rule', 'help session'],

  async execute(args, flags, context) {
    const registry = getRegistry();
    const target = (args[0] || '').toLowerCase();

    if (target) {
      const cmd = registry.get(target);
      if (!cmd) {
        return `Unknown command: /${target}\nType /help for a list of all commands.`;
      }

      let output = `/${cmd.name}`;
      if (cmd.args.length > 0) {
        const argStr = cmd.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ');
        output += ` ${argStr}`;
      }
      output += `\n  ${cmd.description}`;

      if (cmd.args.length > 0) {
        output += '\n  Arguments:';
        cmd.args.forEach(a => {
          output += `\n    ${a.name}${a.required ? ' (required)' : ' (optional)'} — ${a.description || ''}`;
        });
      }

      if (cmd.examples.length > 0) {
        output += '\n  Examples:';
        cmd.examples.forEach(ex => {
          output += `\n    /${cmd.name} ${ex}`;
        });
      }

      return output;
    }

    // List all commands
    const cmds = registry.list();
    const lines = ['Available slash commands:'];
    for (const cmd of cmds.sort((a, b) => a.name.localeCompare(b.name))) {
      let line = `  /${cmd.name}`;
      if (cmd.args.length > 0) {
        const argStr = cmd.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ');
        line += ` ${argStr}`;
      }
      if (cmd.description) {
        line += ` — ${cmd.description}`;
      }
      lines.push(line);
    }
    lines.push('\nUse /help <command> for details on a specific command.');
    return lines.join('\n');
  }
};

export default helpCommand;
