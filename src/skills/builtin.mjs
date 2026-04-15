import fs from 'node:fs';
import path from 'node:path';

function normalizeSkillName(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function builtinSkillsDir(root = process.cwd()) {
  return path.join(root, 'src', 'skills');
}

export function listBuiltinSkills(root = process.cwd()) {
  const dir = builtinSkillsDir(root);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(dir, entry.name);
    const indexPath = path.join(skillDir, 'index.mjs');
    const readmePath = path.join(skillDir, 'README.md');
    const skillDocPath = path.join(skillDir, 'SKILL.md');
    const docPath = fs.existsSync(readmePath) ? readmePath : (fs.existsSync(skillDocPath) ? skillDocPath : null);
    if (!fs.existsSync(indexPath) || !docPath) continue;
    const name = normalizeSkillName(entry.name);
    if (!name) continue;
    skills.push({
      name,
      source: 'builtin',
      approved: true,
      verdict: 'safe',
      usageCount: 0,
      installedAt: null,
      lastUsedAt: null,
      isBundle: true,
      filePath: skillDir,
      execPath: indexPath,
      docPath
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveBuiltinSkill(name, root = process.cwd()) {
  const normalized = normalizeSkillName(name);
  if (!normalized) return null;
  return listBuiltinSkills(root).find((row) => row.name === normalized) || null;
}
