#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const TARGET = 'docs/SELF_READING_INDEX.md';
const before = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';

const regen = spawnSync('node', ['scripts/build-self-reading-index.mjs'], { stdio: 'inherit' });
if (regen.status !== 0) process.exit(regen.status || 1);

const after = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
if (before !== after) {
  console.error('[docs-index-check] FAIL: docs/SELF_READING_INDEX.md is stale. Run: pnpm docs:index');
  process.exit(1);
}

console.log('[docs-index-check] PASS');
