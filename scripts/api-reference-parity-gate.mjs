#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const API_DOC = path.join(ROOT, 'docs', 'API_REFERENCE.md');
const ROUTE_DIR = path.join(ROOT, 'src', 'server', 'routes');
const SERVER_FILE = path.join(ROOT, 'src', 'server.mjs');

function normalizePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.split('?')[0].replace(/\/+$/, '') || '/';
}

function extractIfConditions(text) {
  const src = String(text || '');
  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    if (src.slice(i, i + 4) !== 'if (') continue;
    let j = i + 4;
    let depth = 1;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      j += 1;
    }
    if (depth === 0) {
      out.push(src.slice(i + 4, j - 1));
      i = j;
    }
  }
  return out;
}

function collectRuntimeRoutes() {
  const files = [
    SERVER_FILE,
    ...fs.readdirSync(ROUTE_DIR)
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => path.join(ROUTE_DIR, name))
  ];

  const exact = new Set();
  const prefix = new Set();
  const conditionsByMethod = new Map();
  const methodPathRegex = /req\.method\s*===\s*'([A-Z]+)'/g;
  const exactPathRegex = /url\.pathname\s*===\s*'([^']+)'/g;
  const prefixPathRegex = /url\.pathname\.startsWith\(\s*'([^']+)'\s*\)/g;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const conditions = extractIfConditions(text);
    for (const condition of conditions) {
      const methods = [...condition.matchAll(methodPathRegex)].map((m) => String(m[1]).trim().toUpperCase());
      if (!methods.length) continue;
      const normalizedCondition = String(condition)
        .replace(/\\\//g, '/')
        .replace(/\s+/g, ' ')
        .trim();
      const exactPaths = [...condition.matchAll(exactPathRegex)].map((m) => normalizePath(m[1]));
      const prefixes = [...condition.matchAll(prefixPathRegex)].map((m) => normalizePath(m[1]));
      for (const method of methods) {
        if (!conditionsByMethod.has(method)) conditionsByMethod.set(method, []);
        conditionsByMethod.get(method).push(normalizedCondition);
        for (const p of exactPaths) exact.add(`${method} ${p}`);
        for (const p of prefixes) prefix.add(`${method} ${p}`);
      }
    }
  }
  return { exact, prefix, conditionsByMethod };
}

function parseApiReferenceEndpoints() {
  const text = fs.readFileSync(API_DOC, 'utf8');
  const endpoints = [];
  const pattern = /-\s*`(GET|POST|PUT|PATCH|DELETE)\s+([^`]+)`/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const method = String(m[1]).toUpperCase();
    const endpoint = normalizePath(m[2]);
    if (!endpoint.startsWith('/')) continue;
    endpoints.push({ method, endpoint });
  }
  return endpoints;
}

function endpointImplemented({ method, endpoint }, runtime) {
  const key = `${method} ${endpoint}`;
  if (runtime.exact.has(key)) return true;
  for (const pref of runtime.prefix) {
    const [prefMethod, prefPath] = pref.split(' ');
    if (prefMethod !== method) continue;
    if (endpoint.startsWith(prefPath)) return true;
  }
  if (endpoint.includes('/:')) {
    const dynamicPrefix = normalizePath(endpoint.split('/:')[0]);
    const prefKey = `${method} ${dynamicPrefix}/`;
    if (runtime.prefix.has(prefKey)) return true;
    for (const pref of runtime.prefix) {
      const [prefMethod, prefPath] = pref.split(' ');
      if (prefMethod !== method) continue;
      if (`${dynamicPrefix}/`.startsWith(prefPath) || prefPath.startsWith(`${dynamicPrefix}/`)) return true;
    }
    const methodConditions = runtime.conditionsByMethod.get(method) || [];
    const fragments = endpoint
      .replace(/\?.*$/, '')
      .split(/:[^/]+/g)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    if (fragments.length > 0) {
      const found = methodConditions.some((cond) => fragments.every((frag) => cond.includes(frag)));
      if (found) return true;
    }
  }
  return false;
}

const documented = parseApiReferenceEndpoints();
const runtime = collectRuntimeRoutes();
const missing = documented.filter((item) => !endpointImplemented(item, runtime));

if (missing.length > 0) {
  console.error('[api-reference-parity-gate] FAIL: documented endpoints missing from runtime');
  for (const item of missing) console.error(`  - ${item.method} ${item.endpoint}`);
  process.exit(1);
}

console.log(`[api-reference-parity-gate] PASS (${documented.length} documented endpoints mapped to runtime conditions)`);
