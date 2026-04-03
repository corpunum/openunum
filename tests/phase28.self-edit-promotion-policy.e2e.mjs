import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, stopServer, jpost } from './_helpers.mjs';

const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || 18885);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEST_FILE = 'src/phase28-temp.mjs';

let proc;

try {
  fs.writeFileSync(TEST_FILE, 'export const phase28 = 1;\n', 'utf8');
  proc = await startServer();

  const failed = await jpost('/api/autonomy/self-edit/run', {
    label: 'phase28-policy',
    goal: 'verify runtime promotion policy blocks unsafe promotion',
    baseUrl: BASE_URL,
    edits: [
      {
        tool: 'file_patch',
        args: {
          path: TEST_FILE,
          find: '1',
          replace: '2'
        }
      }
    ],
    validationCommands: ['node -e "process.exit(0)"'],
    canaryChecks: []
  });
  assert.equal(failed.status, 400);
  assert.equal(failed.json.ok, false);
  assert.equal(failed.json.run.status, 'rolled_back');
  assert.equal(Array.isArray(failed.json.run.promotionChecks), true);
  assert.equal(failed.json.run.promotionChecks.at(-1).ok, false);
  assert.match(String(failed.json.run.lastError || ''), /missing_required_validation|missing_required_canary/);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), 'export const phase28 = 1;\n');

  console.log('phase28.self-edit-promotion-policy.e2e: ok');
} finally {
  await stopServer(proc);
  fs.rmSync(TEST_FILE, { force: true });
}
