import assert from 'node:assert/strict';
import { startServer, stopServer, jget } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();

  const stateContract = await jget('/api/runtime/state-contract');
  assert.equal(stateContract.status, 200);
  assert.equal(stateContract.json.contractVersion, '2026-04-08.runtime-state.v1');
  assert.equal(stateContract.json.validation?.ok, true);
  assert.equal(typeof stateContract.json.packet?.fingerprint, 'string');
  assert.equal(stateContract.json.packet?.fingerprint?.length, 64);

  const parity = await jget('/api/runtime/config-parity');
  assert.equal(parity.status, 200);
  assert.equal(parity.json.contractVersion, '2026-04-08.config-parity.v1');
  assert.equal(typeof parity.json.ok, 'boolean');
  assert.equal(Array.isArray(parity.json.issues), true);

  console.log('phase38 runtime-contract-parity e2e: ok');
} finally {
  await stopServer(proc);
}
