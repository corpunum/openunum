import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const uiDir = path.join(repoRoot, 'src', 'ui');
const uiRoutePath = path.join(repoRoot, 'src', 'server', 'routes', 'ui.mjs');

const allowedUiFiles = new Set(['index.html']);

function fail(message) {
  console.error(`[ui-surface-gate] FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(uiDir)) {
  fail('src/ui directory missing');
}

const entries = fs.readdirSync(uiDir, { withFileTypes: true });
const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
const unexpected = files.filter((name) => !allowedUiFiles.has(name));
if (unexpected.length > 0) {
  fail(`unexpected active UI files in src/ui: ${unexpected.join(', ')}`);
}

for (const required of allowedUiFiles) {
  if (!files.includes(required)) {
    fail(`missing required active UI file: ${required}`);
  }
}

const uiRoute = fs.readFileSync(uiRoutePath, 'utf8');
if (!uiRoute.includes("src/ui/index.html")) {
  fail('ui route is not serving src/ui/index.html as canonical UI surface');
}
if (uiRoute.includes('new_ui.html')) {
  fail('ui route still references legacy new_ui.html surface');
}

console.log('[ui-surface-gate] PASS (single canonical active UI surface: src/ui/index.html)');
