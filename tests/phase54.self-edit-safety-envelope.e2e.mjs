import assert from 'node:assert/strict';
import { startServer, stopServer, jpost } from './_helpers.mjs';

let proc;

try {
  proc = await startServer();

  const blocked = await jpost('/api/autonomy/self-edit/run', {
    label: 'phase54-protected-block',
    goal: 'verify protected path requires elevated approval',
    edits: [
      {
        tool: 'file_patch',
        args: {
          path: 'src/core/audit-log.mjs',
          find: 'const EVENT_TYPES',
          replace: 'const EVENT_TYPES'
        }
      }
    ],
    validationCommands: [],
    canaryChecks: []
  });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.json?.ok, false);
  assert.match(String(blocked.json?.error || ''), /protected_path_requires_elevated_approval/i);

  console.log('phase54.self-edit-safety-envelope.e2e: ok');
} finally {
  await stopServer(proc);
}

