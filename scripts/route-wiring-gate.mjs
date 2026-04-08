#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SERVER_FILE = path.join(ROOT, 'src', 'server.mjs');
const ROUTES_DIR = path.join(ROOT, 'src', 'server', 'routes');

const serverText = fs.readFileSync(SERVER_FILE, 'utf8');
const routeFiles = fs.readdirSync(ROUTES_DIR)
  .filter((name) => name.endsWith('.mjs'))
  .sort();

const importPattern = /import\s+\{\s*([^}]+)\s*\}\s+from\s+'\.\/server\/routes\/([^']+)\.mjs';/g;
const importsByFile = new Map();
let match;
while ((match = importPattern.exec(serverText)) !== null) {
  const rawSymbols = String(match[1] || '');
  const symbols = rawSymbols
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const routeFile = `${match[2]}.mjs`;
  importsByFile.set(routeFile, symbols);
}

const missingImports = [];
const missingInvocations = [];

for (const routeFile of routeFiles) {
  const handlers = importsByFile.get(routeFile);
  if (!handlers || handlers.length === 0) {
    missingImports.push(routeFile);
    continue;
  }
  const hasInvocation = handlers.some((handler) => {
    const invokePattern = new RegExp(`\\b${handler}\\s*\\(`);
    return invokePattern.test(serverText);
  });
  if (!hasInvocation) {
    missingInvocations.push(`${routeFile} -> ${handlers.join(', ')}`);
  }
}

if (missingImports.length || missingInvocations.length) {
  console.error('[route-wiring-gate] FAIL');
  for (const item of missingImports) console.error(`  missing import: ${item}`);
  for (const item of missingInvocations) console.error(`  missing invocation: ${item}`);
  process.exit(1);
}

console.log(`[route-wiring-gate] PASS (${routeFiles.length} route modules imported and invoked)`);
