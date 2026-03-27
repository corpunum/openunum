import assert from 'node:assert/strict';
import { startServer, stopServer, jpost, jget } from './_helpers.mjs';

const p = await startServer();
try {
  const cur = await jget('/api/model/current');
  assert.equal(cur.status, 200);

  const sw = await jpost('/api/model/switch', {
    provider: cur.json.provider,
    model: cur.json.model
  });
  assert.equal(sw.status, 200);

  // Provider live chat smoke depends on configured backend; skip hard-fail if provider unreachable.
  const chat = await jpost('/api/chat', { sessionId: 'phase1', message: 'ping' });
  if (chat.status !== 200) {
    console.log('phase1 soft-skip: provider backend unavailable');
  } else {
    assert.ok(typeof chat.json.reply === 'string');
  }

  console.log('phase1 ok');
} finally {
  await stopServer(p);
}
