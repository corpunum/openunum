#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';

const BASE = process.env.OPENUNUM_COMPACT_GATE_BASE || 'HEAD~1';
const HEAD = process.env.OPENUNUM_COMPACT_GATE_HEAD || 'HEAD';

const WATCH_PATHS = [
  'src/config.mjs',
  'src/core/model-execution-envelope.mjs',
  'src/core/context-compiler.mjs',
  'src/core/agent.mjs',
  'src/core/config-parity-check.mjs',
  'src/core/runtime-state-contract.mjs'
];

const WATCH_TOKENS = [
  'compact',
  '4b',
  'contextlimit',
  'maxtooliterations',
  'history',
  'half-life',
  'execution envelope'
];

function gitOutput(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function changedFiles() {
  const out = gitOutput(`git diff --name-only ${BASE} ${HEAD}`);
  if (!out) return [];
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function relevantFileChange(files) {
  return files.some((file) => WATCH_PATHS.includes(file));
}

function relevantTokenChange() {
  const diff = gitOutput(`git diff ${BASE} ${HEAD} -- ${WATCH_PATHS.join(' ')}`);
  if (!diff) return false;
  const normalized = diff.toLowerCase();
  return WATCH_TOKENS.some((token) => normalized.includes(token));
}

function runPhase0Check() {
  const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const out = spawnSync(cmd, ['phase0:check'], { stdio: 'inherit' });
  return Number(out.status || 1) === 0;
}

const files = changedFiles();
const hasFileMatch = relevantFileChange(files);
const hasTokenMatch = hasFileMatch && relevantTokenChange();

if (!hasFileMatch || !hasTokenMatch) {
  console.log('[compact-gate] no compact-profile changes detected; skipping phase0 enforcement gate');
  process.exit(0);
}

console.log('[compact-gate] compact-profile changes detected; enforcing phase0:check');
const ok = runPhase0Check();
if (!ok) {
  console.error('[compact-gate] FAIL: phase0:check failed for compact-profile change set');
  process.exit(1);
}
console.log('[compact-gate] PASS');
