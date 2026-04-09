#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function getTrackedSourceFiles() {
  const out = run('git ls-files');
  const files = out ? out.split('\n').map((f) => f.trim()).filter(Boolean) : [];
  return files.filter((file) =>
    (file.startsWith('src/') || file.startsWith('scripts/') || file.startsWith('tests/')) &&
    (file.endsWith('.mjs') || file.endsWith('.js'))
  );
}

const targets = getTrackedSourceFiles();
let failed = 0;

for (const file of targets) {
  const check = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe', encoding: 'utf8' });
  if (check.status !== 0) {
    failed += 1;
    console.error(`[lint] FAIL: ${file}`);
    const out = `${check.stdout || ''}${check.stderr || ''}`.trim();
    if (out) console.error(out);
  }
}

if (failed > 0) {
  console.error(`[lint] FAIL: ${failed} syntax check(s) failed`);
  process.exit(1);
}

console.log(`[lint] PASS: ${targets.length} JS/MJS files parsed successfully`);
