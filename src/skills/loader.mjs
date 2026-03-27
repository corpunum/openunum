import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir, ensureHome } from '../config.mjs';

export function loadSkills() {
  ensureHome();
  const skillsDir = path.join(getHomeDir(), 'skills');
  const entries = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }) : [];
  const skills = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const skillPath = path.join(skillsDir, e.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    skills.push({ name: e.name, content: fs.readFileSync(skillPath, 'utf8') });
  }
  return skills;
}
