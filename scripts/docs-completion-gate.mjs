#!/usr/bin/env node

import { execSync } from 'node:child_process';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function changedFiles(baseRef, headRef) {
  try {
    const out = run(`git diff --name-only ${baseRef}...${headRef}`);
    return out ? out.split('\n').map((line) => line.trim()).filter(Boolean) : [];
  } catch {
    // Shallow clone or missing ref — try diff against origin/main, then give up gracefully
    try {
      const out = run(`git diff --name-only origin/main...${headRef}`);
      return out ? out.split('\n').map((line) => line.trim()).filter(Boolean) : [];
    } catch {
      console.log('[docs-gate] Cannot determine changed files (shallow clone or missing refs). Passing by default.');
      return [];
    }
  }
}

function isCodePath(file) {
  return file.startsWith('src/') || file.startsWith('scripts/') || file.startsWith('tests/');
}

function isDocPath(file) {
  return (
    file.startsWith('docs/') ||
    file === 'README.md' ||
    file === 'BRAIN.MD' ||
    file === 'CHANGELOG.md'
  );
}

function requiresDocCompanion(file) {
  if (file.startsWith('src/')) return true;
  if (file.startsWith('tests/')) return false;
  if (!file.startsWith('scripts/')) return false;

  const docsMaintenanceScripts = new Set([
    'scripts/docs-completion-gate.mjs',
    'scripts/build-self-reading-index.mjs',
    'scripts/docs-index-freshness-check.mjs'
  ]);
  return !docsMaintenanceScripts.has(file);
}

function main() {
  const baseRef = process.env.OPENUNUM_DOCS_GATE_BASE || 'HEAD~1';
  const headRef = process.env.OPENUNUM_DOCS_GATE_HEAD || 'HEAD';
  const files = changedFiles(baseRef, headRef);

  const codeFiles = files.filter(isCodePath);
  const docFiles = files.filter(isDocPath);
  const docsRequiredBy = codeFiles.filter(requiresDocCompanion);
  const codeChanged = docsRequiredBy.length > 0;
  const docsChanged = docFiles.length > 0;

  console.log(`[docs-gate] base=${baseRef} head=${headRef}`);
  console.log(`[docs-gate] changed=${files.length} code=${codeFiles.length} docs=${docFiles.length} docsRequired=${docsRequiredBy.length}`);

  if (codeChanged && !docsChanged) {
    console.error('[docs-gate] FAIL: code changed without documentation updates.');
    console.error('[docs-gate] Required: update at least one docs path (docs/*, README.md, BRAIN.MD, CHANGELOG.md).');
    process.exit(1);
  }

  console.log('[docs-gate] PASS');
}

main();
