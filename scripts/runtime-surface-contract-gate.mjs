#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.OPENUNUM_SURFACE_GATE_BASE || 'HEAD~1';
const HEAD = process.env.OPENUNUM_SURFACE_GATE_HEAD || 'HEAD';
const API_DOC = 'docs/API_REFERENCE.md';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

const diff = run(`git diff -U0 ${BASE} ${HEAD} -- src/server.mjs src/server/routes/*.mjs`);
if (!diff.trim()) {
  console.log('[surface-gate] no server surface changes detected; skipping');
  process.exit(0);
}

const addedLiterals = new Set();
for (const line of diff.split('\n')) {
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  const matches = line.matchAll(/["'`](\/api\/[A-Za-z0-9_\-./:?=&]+)["'`]/g);
  for (const m of matches) {
    const raw = String(m[1] || '').trim();
    if (!raw.startsWith('/api/')) continue;
    const normalized = raw.split('?')[0];
    addedLiterals.add(normalized);
  }
}

if (addedLiterals.size === 0) {
  console.log('[surface-gate] no new literal API surfaces detected; skipping');
  process.exit(0);
}

const docs = fs.existsSync(API_DOC) ? fs.readFileSync(API_DOC, 'utf8') : '';
const missing = [...addedLiterals].filter((endpoint) => !docs.includes(endpoint));

if (missing.length > 0) {
  console.error('[surface-gate] FAIL: API surfaces missing from docs/API_REFERENCE.md');
  for (const endpoint of missing) console.error(`  - ${endpoint}`);
  process.exit(1);
}

console.log(`[surface-gate] PASS (${addedLiterals.size} surfaces documented)`);
