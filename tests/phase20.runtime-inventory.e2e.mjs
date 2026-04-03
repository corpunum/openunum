import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();

  const uname = await jpost('/api/tool/run', {
    name: 'shell_run',
    args: { cmd: 'uname -a' }
  });
  assert.equal(uname.status, 200);
  assert.equal(uname.json.ok, true);
  assert.equal(uname.json.result.ok, true);

  const git = await jpost('/api/tool/run', {
    name: 'shell_run',
    args: { cmd: 'git status --short --branch' }
  });
  assert.equal(git.status, 200);
  assert.equal(git.json.ok, true);
  assert.equal(git.json.result.ok, true);

  const inventory = await jget('/api/runtime/inventory?limit=100');
  assert.equal(inventory.status, 200);
  assert.equal(typeof inventory.json, 'object');
  assert.equal(typeof inventory.json.system, 'object');
  assert.equal(typeof inventory.json.repo, 'object');
  assert.equal(inventory.json.system.uname?.value?.length > 0, true);
  assert.equal(inventory.json.repo['git.present']?.value, 'true');
  assert.equal(inventory.json.repo['git.last_status']?.value?.length > 0, true);

  console.log('phase20.runtime-inventory.e2e: ok');
} finally {
  await stopServer(proc);
}
