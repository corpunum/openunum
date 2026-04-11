#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { collectRuntimeRoutes } from './lib/route-surface.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TARGET = path.join(ROOT, 'docs', 'ROUTE_REGISTRY.json');

function buildExpected() {
  const runtime = collectRuntimeRoutes(ROOT);
  const exact = [...runtime.exact].sort();
  const prefix = [...runtime.prefix].sort();
  const conditionMethods = {};
  for (const [method, conditions] of runtime.conditionsByMethod.entries()) {
    conditionMethods[method] = [...new Set(conditions)].sort();
  }
  return {
    version: '2026-04-11.route-registry.v1',
    source: {
      server: 'src/server.mjs',
      routes: 'src/server/routes/*.mjs'
    },
    stats: {
      exactCount: exact.length,
      prefixCount: prefix.length,
      methods: Object.keys(conditionMethods).sort()
    },
    endpoints: { exact, prefix },
    conditionsByMethod: conditionMethods
  };
}

if (!fs.existsSync(TARGET)) {
  console.error('[route-registry-freshness] FAIL: docs/ROUTE_REGISTRY.json is missing');
  console.error('[route-registry-freshness] Run: pnpm docs:route-registry');
  process.exit(1);
}

const expected = `${JSON.stringify(buildExpected(), null, 2)}\n`;
const current = fs.readFileSync(TARGET, 'utf8');
if (current !== expected) {
  console.error('[route-registry-freshness] FAIL: docs/ROUTE_REGISTRY.json is stale');
  console.error('[route-registry-freshness] Run: pnpm docs:route-registry');
  process.exit(1);
}

console.log('[route-registry-freshness] PASS');
