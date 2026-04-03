import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || 18881);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEST_FILE = 'tmp/phase19-self-edit.txt';

let proc;

try {
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(TEST_FILE, 'hello\n', 'utf8');

  proc = await startServer();

  const failed = await jpost('/api/autonomy/self-edit/run', {
    label: 'phase19-failure',
    goal: 'verify rollback on failed validation',
    baseUrl: BASE_URL,
    edits: [
      {
        tool: 'file_patch',
        args: {
          path: TEST_FILE,
          find: 'hello',
          replace: 'world'
        }
      }
    ],
    validationCommands: ['node -e "process.exit(7)"'],
    canaryChecks: []
  });
  assert.equal(failed.status, 400);
  assert.equal(failed.json.ok, false);
  assert.equal(failed.json.run.status, 'rolled_back');
  assert.equal(failed.json.run.rollbackResults.length, 1);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), 'hello\n');

  const failedStatus = await jget(`/api/autonomy/self-edit/status?id=${encodeURIComponent(failed.json.run.id)}`);
  assert.equal(failedStatus.status, 200);
  assert.equal(failedStatus.json.ok, true);
  assert.equal(failedStatus.json.run.status, 'rolled_back');

  const promoted = await jpost('/api/autonomy/self-edit/run', {
    label: 'phase19-success',
    goal: 'verify promotion with canary',
    baseUrl: BASE_URL,
    edits: [
      {
        tool: 'file_patch',
        args: {
          path: TEST_FILE,
          find: 'hello',
          replace: 'world'
        }
      }
    ],
    validationCommands: ['node -e "process.exit(0)"'],
    canaryChecks: [
      {
        name: 'health',
        url: `${BASE_URL}/api/health`,
        expectStatus: 200
      }
    ]
  });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.json.ok, true);
  assert.equal(promoted.json.run.status, 'promoted');
  assert.equal(promoted.json.run.canaryResults.length, 1);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), 'world\n');

  const listed = await jget('/api/autonomy/self-edit?limit=10');
  assert.equal(listed.status, 200);
  assert.equal(listed.json.ok, true);
  assert.equal(Array.isArray(listed.json.runs), true);
  assert.equal(listed.json.runs.some((item) => item.id === promoted.json.run.id), true);

  console.log('phase19.self-edit-pipeline.e2e: ok');
} finally {
  await stopServer(proc);
  fs.rmSync(TEST_FILE, { force: true });
}
