#!/usr/bin/env node

import path from 'node:path';
import {
  collectRuntimeRoutes,
  endpointImplemented,
  parseApiReferenceEndpoints
} from './lib/route-surface.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const API_DOC = path.join(ROOT, 'docs', 'API_REFERENCE.md');

const documented = parseApiReferenceEndpoints(API_DOC);
const runtime = collectRuntimeRoutes(ROOT);
const missing = documented.filter((item) => !endpointImplemented(item, runtime));

if (missing.length > 0) {
  console.error('[api-reference-parity-gate] FAIL: documented endpoints missing from runtime');
  for (const item of missing) console.error(`  - ${item.method} ${item.endpoint}`);
  process.exit(1);
}

console.log(`[api-reference-parity-gate] PASS (${documented.length} documented endpoints mapped to runtime conditions)`);
