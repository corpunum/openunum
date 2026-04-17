import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PLAYWRIGHT_STABLE_ARGS, startServer, stopServer } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function waitForCondition(check, timeoutMs = 15000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('condition_timeout');
}

let proc;
let browser;

try {
  proc = await startServer();
  browser = await chromium.launch({
    headless: true,
    args: PLAYWRIGHT_STABLE_ARGS
  });
  const page = await browser.newPage();

  let inventoryGets = 0;
  let configPosts = 0;
  page.on('request', (req) => {
    const method = req.method();
    const url = req.url();
    if (method === 'GET' && url.includes('/api/runtime/tooling-inventory')) inventoryGets += 1;
    if (method === 'POST' && url.includes('/api/config')) configPosts += 1;
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.locator('summary', { hasText: 'Settings' }).click();
  await page.click('.menu-btn[data-view="settings-tooling"]');

  await page.waitForSelector('#toolingToolsBody', { timeout: 15000 });
  await page.waitForSelector('#toolingSkillsBody', { timeout: 15000 });
  await page.waitForSelector('#toolingModelsBody', { timeout: 15000 });
  await waitForCondition(() => inventoryGets > 0, 15000);
  assert.equal(inventoryGets > 0, true, 'tooling screen should fetch runtime inventory');

  await page.selectOption('#mbtEnabled', 'true');
  await page.selectOption('#mbtExpose', 'true');
  await page.fill('#mbtConcurrency', '1');
  await page.fill('#mbtQueueDepth', '8');
  await page.click('#saveToolingRuntime');
  await waitForCondition(() => configPosts > 0, 15000);
  assert.equal(configPosts > 0, true, 'saving tooling runtime should POST /api/config');

  const toolsRows = await page.locator('#toolingToolsBody tr').count();
  assert.equal(toolsRows > 0, true, 'tooling table should contain rows');

  console.log('phase50.webui-tooling-rollout.e2e: ok');
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(proc);
}
