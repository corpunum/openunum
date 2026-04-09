#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const TEXT_EXTENSIONS = ['.mjs', '.js', '.md', '.json', '.yml', '.yaml', '.css', '.html'];

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function isTextFile(file) {
  return TEXT_EXTENSIONS.some((ext) => file.endsWith(ext));
}

function isInScope(file) {
  if (file.startsWith('data/')) return false;
  if (file.startsWith('maintenance/')) return false;
  if (file.startsWith('docs/archive/')) return false;
  if (file.startsWith('docs/research/')) return false;
  if (file.startsWith('src/')) return true;
  if (file.startsWith('scripts/')) return true;
  if (file.startsWith('tests/')) return true;
  if (file.startsWith('docs/')) return true;
  return file === 'README.md' || file === 'BRAIN.MD' || file === 'NEXT_TASKS.md' || file === 'package.json';
}

const tracked = run('git ls-files').split('\n').map((f) => f.trim()).filter(Boolean);
const targets = tracked.filter((file) => isTextFile(file) && isInScope(file));

const violations = [];
for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('\r\n')) violations.push(`${file}: contains CRLF line endings`);
  if (text.length > 0 && !text.endsWith('\n')) violations.push(`${file}: missing trailing newline`);
}

if (violations.length > 0) {
  console.error('[format-check] FAIL');
  for (const line of violations) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(`[format-check] PASS: ${targets.length} text files use LF + trailing newline`);
