import assert from 'node:assert/strict';
import { startServer, stopServer } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);

let proc;
try {
  proc = await startServer();

  const root = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
  assert.equal(root.status, 200, 'index should be served');
  const html = await root.text();
  assert.equal(html.includes('href="/ui/styles.css"'), true, 'index should reference external styles');
  assert.equal(html.includes('src="/ui/app.js"'), true, 'index should reference external app script');

  const css = await fetch(`http://127.0.0.1:${TEST_PORT}/ui/styles.css`);
  assert.equal(css.status, 200, 'styles.css should be served');
  assert.equal(String(css.headers.get('content-type') || '').includes('text/css'), true, 'styles.css content-type should be text/css');
  const cssBody = await css.text();
  assert.equal(cssBody.includes('.layout'), true, 'styles.css should contain expected layout rules');

  const js = await fetch(`http://127.0.0.1:${TEST_PORT}/ui/app.js`);
  assert.equal(js.status, 200, 'app.js should be served');
  assert.equal(String(js.headers.get('content-type') || '').includes('application/javascript'), true, 'app.js content-type should be javascript');
  const jsBody = await js.text();
  assert.equal(
    jsBody.includes('wireUiLifecycle({') && jsBody.includes('runUiBootstrap'),
    true,
    'app.js should contain expected UI bootstrap wiring'
  );

  const missing = await fetch(`http://127.0.0.1:${TEST_PORT}/ui/missing.js`);
  assert.equal(missing.status, 404, 'unknown ui asset should return 404');

  console.log('phase43.ui-static-assets.e2e: ok');
} finally {
  await stopServer(proc);
}
