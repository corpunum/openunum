import assert from 'node:assert/strict';
import { CDPBrowser } from '../src/browser/cdp.mjs';
import { loadConfig } from '../src/config.mjs';

const browser = new CDPBrowser(loadConfig().browser.cdpUrl);
const st = await browser.status();
if (!st.ok) {
  console.log('phase3 soft-skip: CDP not available on 127.0.0.1:9222');
  process.exit(0);
}
assert.equal(st.ok, true);
const snap = await browser.snapshot();
assert.ok(snap && typeof snap === 'object');
console.log('phase3 ok');
