import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logInfo, logError } from '../../logger.mjs';

const RULES_DIR = 'data/rules';
const MAX_ACTIVE_RULES = 10;

function getRulesDir(workspaceRoot) {
  return path.join(workspaceRoot || process.cwd(), RULES_DIR);
}

function ensureRulesDir(workspaceRoot) {
  const dir = getRulesDir(workspaceRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function loadRules(workspaceRoot) {
  const dir = getRulesDir(workspaceRoot);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return data;
    } catch { return null; }
  }).filter(Boolean);
}

function saveRule(rule, workspaceRoot) {
  const dir = ensureRulesDir(workspaceRoot);
  const filename = `${rule.id}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(rule, null, 2));
  return rule;
}

function deleteRule(id, workspaceRoot) {
  const dir = getRulesDir(workspaceRoot);
  const filePath = path.join(dir, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

export const ruleCommand = {
  name: 'rule',
  description: 'Manage persistent behavioral rules',
  args: [
    { name: 'action', required: true, description: 'Action: add, list, remove, or active' },
    { name: 'text', required: false, description: 'Rule text (for add)' }
  ],
  source: 'builtin/rule.mjs',
  examples: [
    'rule add Always verify file existence before claiming success',
    'rule list',
    'rule active',
    'rule remove abc123'
  ],

  async execute(args, flags, context) {
    const workspaceRoot = context.config?.server?.workspaceRoot || process.cwd();
    const action = (args[0] || '').toLowerCase();

    if (action === 'add') {
      const text = args.slice(1).join(' ').trim();
      if (!text) return 'Usage: /rule add <your rule text>';

      const rules = loadRules(workspaceRoot);
      if (rules.filter(r => r.active).length >= MAX_ACTIVE_RULES) {
        return `Error: Maximum ${MAX_ACTIVE_RULES} active rules reached. Remove one first with /rule remove <id>`;
      }

      const rule = {
        id: crypto.randomBytes(6).toString('hex'),
        text,
        active: true,
        createdAt: new Date().toISOString(),
        source: 'user'
      };

      saveRule(rule, workspaceRoot);
      logInfo('rule_added', { id: rule.id, text: text.slice(0, 100) });

      return [
        `Rule saved: ${rule.id}`,
        `  "${text}"`,
        `Active rules: ${rules.filter(r => r.active).length + 1}/${MAX_ACTIVE_RULES}`
      ].join('\n');
    }

    if (action === 'list' || action === 'active') {
      const rules = loadRules(workspaceRoot);
      const filtered = action === 'active' ? rules.filter(r => r.active) : rules;

      if (filtered.length === 0) {
        return action === 'active' ? 'No active rules. Add one with /rule add <text>' : 'No rules stored.';
      }

      const lines = [`${action === 'active' ? 'Active' : 'All'} rules (${filtered.length}):`];
      filtered.forEach((r, i) => {
        const status = r.active ? '✓' : '○';
        lines.push(`  ${status} ${r.id} — "${r.text}"`);
        lines.push(`    created: ${r.createdAt}`);
      });

      return lines.join('\n');
    }

    if (action === 'remove') {
      const targetId = (args[1] || '').trim();
      if (!targetId) return 'Usage: /rule remove <rule-id>';

      const deleted = deleteRule(targetId, workspaceRoot);
      if (deleted) {
        logInfo('rule_removed', { id: targetId });
        return `Rule ${targetId} removed.`;
      }
      return `Rule ${targetId} not found.`;
    }

    return 'Usage: /rule add <text> | /rule list | /rule active | /rule remove <id>';
  }
};

export { loadRules };
export default ruleCommand;
