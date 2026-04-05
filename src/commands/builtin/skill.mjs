import { logInfo, logWarn } from '../../logger.mjs';

export const skillCommand = {
  name: 'skill',
  description: 'List and manage skills',
  args: [
    { name: 'action', required: false, description: 'Action: list (default)' }
  ],
  source: 'builtin/skill.mjs',

  async execute(args, flags, context) {
    const action = (args[0] || 'list').toLowerCase();

    if (action === 'list') {
      // Try to load skills from the agent's skill loader if available
      const agent = context.agent;
      if (agent && typeof agent.getLoadedSkills === 'function') {
        const skills = agent.getLoadedSkills();
        if (skills.length === 0) {
          return 'No skills loaded.';
        }
        const lines = [`Loaded skills (${skills.length}):`];
        skills.forEach((s, i) => {
          lines.push(`  ${i + 1}. ${s.name || s.id} — ${s.description || 'no description'}`);
        });
        return lines.join('\n');
      }

      // Fallback: check for skills directory
      const skillsDir = context.config?.skills?.directory || 'src/skills';
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = path.join(context.config?.server?.workspaceRoot || process.cwd(), skillsDir);
        if (!fs.existsSync(dir)) {
          return 'Skills directory not found. No skills configured.';
        }
        const entries = fs.readdirSync(dir, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name);

        if (entries.length === 0) {
          return 'No skills directories found.';
        }

        const lines = [`Available skill directories (${entries.length}):`];
        entries.forEach((name, i) => {
          lines.push(`  ${i + 1}. ${name}`);
        });
        return lines.join('\n');
      } catch {
        return 'Skills directory not accessible.';
      }
    }

    return 'Usage: /skill list';
  }
};

export default skillCommand;
