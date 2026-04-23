import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PLAYWRIGHT_STABLE_ARGS, startServer, stopServer } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let proc;
let browser;

try {
  proc = await startServer();
  browser = await chromium.launch({
    headless: true,
    args: PLAYWRIGHT_STABLE_ARGS
  });
  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  await page.locator('#settingsGearBtn').click();
  await page.waitForSelector('#settingsHub[open]', { timeout: 5000 });
  await page.locator('.settings-rail-item', { hasText: 'Runtime' }).click();
  await page.waitForSelector('#autonomySelfAwarenessValue', { timeout: 15000 });

  await page.click('#refreshAutonomyDashboardBtn');
  await page.waitForFunction(() => {
    const text = String(document.querySelector('#autonomyDashboardSummary')?.textContent || '');
    return text.length > 0 && !/loading autonomy dashboard/i.test(text);
  }, { timeout: 15000 });

  const summary = String(await page.locator('#autonomyDashboardSummary').textContent() || '').trim();
  assert.equal(summary.includes('selfAwareness='), true);

  const awarenessValue = String(await page.locator('#autonomySelfAwarenessValue').textContent() || '').trim();
  assert.equal(awarenessValue !== '-' && awarenessValue.length > 0, true);

  const queueValue = String(await page.locator('#autonomyQueueValue').textContent() || '').trim();
  assert.equal(queueValue.includes('pending'), true);

  const remediationValue = String(await page.locator('#autonomyRemediationValue').textContent() || '').trim();
  assert.equal(remediationValue.includes('items'), true);

  await page.click('#syncAutonomyRemediationBtn');
  await page.waitForTimeout(300);
  const runtimeStatus = String(await page.locator('#runtimeStatus').textContent() || '').trim();
  assert.equal(runtimeStatus.length > 0, true);

  await page.close();
  console.log('phase55.webui-autonomy-dashboard.e2e: ok');
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(proc);
}
