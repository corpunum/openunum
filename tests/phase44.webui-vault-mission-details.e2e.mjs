import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, stopServer } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function waitForCondition(check, timeoutMs = 7000, intervalMs = 100) {
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
    args: ['--disable-gpu', '--disable-dev-shm-usage']
  });

  {
    const page = await browser.newPage();
    let providerTests = 0;
    let authCatalogPosts = 0;

    await page.route(/\/api\/provider\/test(?:\?.*)?$/, async (route) => {
      providerTests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, modelCount: 5, topModel: 'test-model' })
      });
    });
    await page.route(/\/api\/auth\/catalog(?:\?.*)?$/, async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') {
        await route.continue();
        return;
      }
      authCatalogPosts += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.locator('summary', { hasText: 'Settings' }).click();
    await page.click('.menu-btn[data-view="provider-config"]');
    await page.waitForSelector('.provider-modal', { timeout: 15000 });
    await page.locator('.provider-modal').first().click();
    await page.waitForSelector('#vaultEditModal[open]', { timeout: 5000 });

    await page.click('#vaultEditTest');
    await waitForCondition(() => providerTests > 0, 8000);

    await page.fill('#vaultProviderBase', 'http://127.0.0.1:11434');
    await page.click('#vaultEditSave');
    await waitForCondition(() => authCatalogPosts > 0, 8000);

    await page.waitForFunction(() => !document.querySelector('#vaultEditModal')?.open);
    await page.close();
  }

  {
    const page = await browser.newPage();
    const missionState = {
      id: 'mission-details-test',
      sessionId: 'session-mission-details-test',
      goal: 'validate mission details filtering',
      status: 'running',
      step: 2,
      maxSteps: 6,
      hardStepCap: 6,
      retries: 1,
      startedAt: new Date().toISOString(),
      finishedAt: null
    };

    await page.route(/\/api\/missions(?:\/.*)?(?:\?.*)?$/, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const method = req.method();

      if (method === 'GET' && url.pathname === '/api/missions') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ missions: [missionState], schedules: [] })
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/missions/status') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mission: missionState })
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/missions/timeline') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            mission: missionState,
            log: [{ step: 2, at: new Date().toISOString(), reply: 'alpha signal complete' }],
            toolRuns: [{ toolName: 'beta-tool', ok: true, createdAt: new Date().toISOString(), result: { ok: true } }],
            recentStrategies: [{ success: true, strategy: 'gamma-plan', evidence: 'alpha trace', goal: missionState.goal }],
            compactions: [],
            artifacts: [{ type: 'note', content: 'delta artifact', sourceRef: 'mission-details-test' }]
          })
        });
        return;
      }
      await route.continue();
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.click('.menu-btn[data-view="missions"]');
    await page.waitForFunction(() => {
      const picker = document.querySelector('#missionPicker');
      return Boolean(picker && picker.querySelectorAll('option').length > 1);
    }, { timeout: 15000 });

    await page.selectOption('#missionPicker', 'mission-details-test');
    await page.click('#loadMissionBtn');
    await page.click('#refreshMission');

    await page.selectOption('#missionTimelineFilter', 'log');
    await page.fill('#missionTimelineSearch', 'alpha');
    await page.waitForFunction(() => String(document.querySelector('#missionTimelineLog')?.textContent || '').includes('alpha signal complete'));

    await page.selectOption('#missionTimelineFilter', 'tools');
    await page.fill('#missionTimelineSearch', 'beta-tool');
    await page.waitForFunction(() => String(document.querySelector('#missionTimelineTools')?.textContent || '').includes('beta-tool'));

    const summary = String((await page.locator('#missionTimelineSummary').textContent()) || '');
    assert.equal(summary.includes('status=running'), true, 'mission summary should render running status');
    await page.close();
  }

  console.log('phase44.webui-vault-mission-details.e2e: ok');
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(proc);
}
