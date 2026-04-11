#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { collectRuntimeRoutes } from './lib/route-surface.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUTPUT = path.join(ROOT, 'docs', 'ROUTE_REGISTRY.json');

const runtime = collectRuntimeRoutes(ROOT);
const exact = [...runtime.exact].sort();
const prefix = [...runtime.prefix].sort();
const conditionMethods = {};
for (const [method, conditions] of runtime.conditionsByMethod.entries()) {
  conditionMethods[method] = [...new Set(conditions)].sort();
}

const registry = {
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
  endpoints: {
    exact,
    prefix
  },
  conditionsByMethod: conditionMethods
};

const serialized = `${JSON.stringify(registry, null, 2)}\n`;
fs.writeFileSync(OUTPUT, serialized, 'utf8');
console.log(`[route-registry] wrote ${path.relative(ROOT, OUTPUT)} (${exact.length} exact, ${prefix.length} prefix)`);
