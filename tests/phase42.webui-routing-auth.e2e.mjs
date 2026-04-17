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

  let configPosts = 0;
  let authCatalogPosts = 0;
  page.on('request', (req) => {
    const method = req.method();
    const url = req.url();
    if (method === 'POST' && url.includes('/api/config')) configPosts += 1;
    if (method === 'POST' && url.includes('/api/auth/catalog')) authCatalogPosts += 1;
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  await page.locator('summary', { hasText: 'Settings' }).click();

  await page.click('.menu-btn[data-view="model-routing"]');
  await page.waitForSelector('#provider', { timeout: 15000 });

  await page.click('#loadModels');
  await page.waitForFunction(() => {
    const modelList = document.querySelector('#modelList');
    return Boolean(modelList && modelList.querySelectorAll('option').length > 0);
  }, { timeout: 15000 });

  const providerValue = await page.inputValue('#provider');
  const modelValue = await page.inputValue('#modelList');
  if (!providerValue) {
    await page.selectOption('#provider', 'ollama-cloud');
  }
  if (!modelValue) {
    const options = page.locator('#modelList option');
    const optionCount = await options.count();
    assert.equal(optionCount > 0, true, 'model list should contain at least one option');
    const first = await options.first().getAttribute('value');
    if (first) {
      await page.selectOption('#modelList', first);
    }
  }

  await page.selectOption('#fallbackEnabled', 'false');
  await page.click('#saveRouting');
  await waitForCondition(() => configPosts > 0, 15000);
  assert.equal(configPosts > 0, true, 'save routing should POST /api/config');

  await page.click('.menu-btn[data-view="provider-config"]');
  await page.waitForSelector('.service-modal', { timeout: 15000 });

  const preferredServiceBtn = page.locator('.service-modal[data-service="github"]');
  const serviceBtn = (await preferredServiceBtn.count()) > 0 ? preferredServiceBtn : page.locator('.service-modal').first();
  const serviceId = String(await serviceBtn.getAttribute('data-service') || '').trim();
  assert.equal(Boolean(serviceId), true, 'service modal button must have data-service id');

  await serviceBtn.click();
  await page.waitForSelector('#vaultEditModal[open]', { timeout: 5000 });

  const modalTitle = String(await page.locator('#vaultEditTitle').textContent() || '').trim();
  assert.equal(modalTitle.includes(`Service Vault: ${serviceId}`), true, 'service modal title should include selected service id');

  const secretInput = page.locator('#vaultServiceSecret');
  if (await secretInput.count()) {
    await secretInput.fill(`phase42-secret-${Date.now()}`);
  }

  await page.click('#vaultEditSave');
  await page.waitForFunction(() => !document.querySelector('#vaultEditModal')?.open, { timeout: 10000 });
  await waitForCondition(() => authCatalogPosts > 0, 15000);
  assert.equal(authCatalogPosts > 0, true, 'service vault save should POST /api/auth/catalog');

  await page.close();
  console.log('phase42.webui-routing-auth.e2e: ok');
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(proc);
}
