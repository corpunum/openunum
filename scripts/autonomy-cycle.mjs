#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir } from '../src/config.mjs';

const baseUrl = process.env.OPENUNUM_BASE_URL || 'http://127.0.0.1:18880';

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.response = json;
    throw error;
  }
  return json;
}

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.response = json;
    throw error;
  }
  return json;
}

async function main() {
  const startedAt = new Date().toISOString();
  const cycle = await postJson(`${baseUrl}/api/autonomy/master/cycle`, {});
  const diagnostics = await getJson(`${baseUrl}/api/audit/diagnostics`);
  const summary = {
    ok: true,
    ranAt: new Date().toISOString(),
    startedAt,
    source: 'scheduled-autonomy-cycle',
    cycle: cycle?.result?.cycle || null,
    health: cycle?.result?.health?.status || 'unknown',
    issues: Array.isArray(cycle?.result?.issues) ? cycle.result.issues.length : 0,
    nudges: Array.isArray(cycle?.result?.nudges) ? cycle.result.nudges.length : 0,
    auditValid: diagnostics?.verification?.valid ?? null,
    auditStrictValid: diagnostics?.verification?.strictValid ?? null,
    auditIssues: Array.isArray(diagnostics?.issues) ? diagnostics.issues.map((item) => item.code) : []
  };
  const snapshotPath = path.join(getHomeDir(), 'autonomy-cycle-last.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: String(error.message || error),
    response: error.response || null
  }, null, 2));
  process.exit(1);
});
