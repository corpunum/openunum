#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const GENERATED_TRACKED_PATTERNS = [
  'data/audit-log.jsonl',
  'data/working-memory/',
  'data/side-quests/'
];

const ABSOLUTE_PATH_LEAK_PATTERNS = [
  `/home/${'corp-unum'}/`,
  `/home/${'corp-unum'}`
];

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function getTrackedFiles(prefix = '') {
  const cmd = prefix
    ? `git ls-files -- ${prefix}`
    : 'git ls-files';
  const out = run(cmd);
  return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

const trackedData = getTrackedFiles('data');
const trackedViolations = trackedData.filter((file) =>
  GENERATED_TRACKED_PATTERNS.some((pattern) => file === pattern || file.startsWith(pattern))
);

const trackedSrcScripts = [...getTrackedFiles('src'), ...getTrackedFiles('scripts')];
const absolutePathViolations = [];
for (const file of trackedSrcScripts) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of ABSOLUTE_PATH_LEAK_PATTERNS) {
    if (!text.includes(pattern)) continue;
    absolutePathViolations.push(`${file} (contains '${pattern}')`);
    break;
  }
}

if (trackedViolations.length || absolutePathViolations.length) {
  console.error('[repo-hygiene-gate] FAIL');
  if (trackedViolations.length) {
    console.error('  tracked generated artifacts detected:');
    for (const file of trackedViolations) console.error(`    - ${file}`);
  }
  if (absolutePathViolations.length) {
    console.error('  machine-specific absolute paths detected in tracked src/scripts files:');
    for (const file of absolutePathViolations) console.error(`    - ${file}`);
  }
  process.exit(1);
}

console.log('[repo-hygiene-gate] PASS (no tracked runtime artifacts, no machine-specific absolute path leaks in src/scripts)');
