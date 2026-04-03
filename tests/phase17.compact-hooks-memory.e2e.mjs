import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || 18881);
const TEST_HOME = path.join(os.tmpdir(), `openunum-test-home-${TEST_PORT}`);
let proc;
const originalHome = process.env.OPENUNUM_HOME;

try {
  proc = await startServer();

  const hooksDir = path.join(TEST_HOME, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(
    path.join(hooksDir, 'pre-tool.mjs'),
    `export default async function handle(payload) {
  return { note: 'pre hook observed ' + payload.toolName };
}
`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(hooksDir, 'post-tool.mjs'),
    `export default async function handle() {
  return { note: 'post hook completed', result: { hookTouched: true } };
}
`,
    'utf8'
  );

  const toolRun = await jpost('/api/tool/run', {
    name: 'shell_run',
    args: { cmd: 'pwd' }
  });
  assert.equal(toolRun.status, 200);
  assert.equal(toolRun.json.ok, true);
  assert.equal(toolRun.json.result.ok, true);
  assert.equal(toolRun.json.result.hookTouched, true);
  assert.equal(Array.isArray(toolRun.json.result.hookEvents), true);
  assert.equal(toolRun.json.result.hookEvents.length >= 2, true);

  const compactMode = await jpost('/api/autonomy/mode', { mode: 'compact-local' });
  assert.equal(compactMode.status, 200);
  assert.equal(compactMode.json.mode, 'compact-local');

  const compactStatus = await jget('/api/autonomy/mode');
  assert.equal(compactStatus.status, 200);
  assert.equal(compactStatus.json.mode, 'compact-local');

  const sessionId = `phase17-${Date.now()}`;
  const infoChat = await jpost('/api/chat', {
    sessionId,
    message: 'My name is Ada. Which model are you using?'
  });
  assert.equal(infoChat.status, 200);
  assert.equal(typeof infoChat.json.reply, 'string');

  process.env.OPENUNUM_HOME = TEST_HOME;
  const { MemoryStore } = await import('../src/memory/store.mjs');
  const memory = new MemoryStore();
  const ownerFacts = memory.retrieveFacts('owner.name', 10);
  const runtimeFacts = memory.retrieveFacts('runtime.last_model', 10);
  assert.equal(ownerFacts.some((row) => row.key === 'owner.name' && row.value.includes('Ada')), true);
  assert.equal(runtimeFacts.some((row) => row.key === 'runtime.last_model'), true);

  console.log('phase17.compact-hooks-memory.e2e: ok');
} finally {
  if (originalHome == null) delete process.env.OPENUNUM_HOME;
  else process.env.OPENUNUM_HOME = originalHome;
  await stopServer(proc);
}
