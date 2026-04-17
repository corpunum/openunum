import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PLAYWRIGHT_STABLE_ARGS, startServer, stopServer } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function waitForCondition(check, timeoutMs = 7000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
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

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.locator('summary', { hasText: 'Settings' }).click();
  await page.click('.menu-btn[data-view="provider-config"]');
  await page.waitForSelector('#providerMatrixBody .provider-hide', { timeout: 15000 });
  await page.waitForSelector('#authMethodBody .service-hide', { timeout: 15000 });

  const providerId = await page.locator('#providerMatrixBody .provider-hide').first().getAttribute('data-provider');
  assert.equal(Boolean(providerId), true, 'missing provider id for hide/add flow');
  await page.click(`#providerMatrixBody .provider-hide[data-provider="${providerId}"]`);

  await waitForCondition(async () => {
    return await page.evaluate((id) => {
      const select = document.querySelector('#providerAddSelect');
      return Boolean(select && [...select.options].some((opt) => opt.value === id));
    }, providerId);
  });

  await page.selectOption('#providerAddSelect', providerId);
  await page.click('#addProviderRow');
  await waitForCondition(async () => {
    const count = await page.locator(`#providerMatrixBody .provider-open[data-provider="${providerId}"]`).count();
    return count > 0;
  });

  const serviceId = await page.locator('#authMethodBody .service-hide').first().getAttribute('data-service');
  assert.equal(Boolean(serviceId), true, 'missing service id for hide/add flow');
  await page.click(`#authMethodBody .service-hide[data-service="${serviceId}"]`);

  await waitForCondition(async () => {
    return await page.evaluate((id) => {
      const select = document.querySelector('#serviceAddSelect');
      return Boolean(select && [...select.options].some((opt) => opt.value === id));
    }, serviceId);
  });

  await page.selectOption('#serviceAddSelect', serviceId);
  await page.click('#addServiceRow');
  await waitForCondition(async () => {
    return await page.evaluate((id) => {
      const select = document.querySelector('#serviceAddSelect');
      const hasAddOption = Boolean(select && [...select.options].some((opt) => opt.value === id));
      const rowExists = Boolean(document.querySelector(`#authMethodBody .service-advanced[data-service="${id}"]`));
      return rowExists && !hasAddOption;
    }, serviceId);
  });

  await page.close();
  console.log('phase45.webui-vault-add-rows.e2e: ok');
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(proc);
}
