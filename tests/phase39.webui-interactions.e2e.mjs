import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, stopServer } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function text(page, selector) {
  return String((await page.locator(selector).first().textContent()) || '').trim();
}

async function waitForCondition(check, timeoutMs = 5000, intervalMs = 100) {
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
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    await page.locator('summary', { hasText: 'Settings' }).click();
    await page.click('.menu-btn[data-view="provider-config"]');
    await page.waitForSelector('#providerMatrixBody tr', { timeout: 15000 });

    const initialRows = await page.locator('#providerMatrixBody tr').count();
    assert.equal(initialRows > 0, true, 'provider matrix should render at least one row');

    await page.locator('.provider-modal').first().click();
    await page.waitForSelector('#vaultEditModal[open]', { timeout: 5000 });
    const title = await text(page, '#vaultEditTitle');
    assert.equal(title.startsWith('Provider Vault:'), true, 'provider modal title should indicate provider vault editing');

    await page.locator('#vaultEditClose').click({ force: true });
    await page.waitForFunction(() => {
      const modal = document.querySelector('#vaultEditModal');
      return !modal || modal.open === false;
    }, { timeout: 10000 });

    const targetProvider = await page.locator('.provider-hide').first().getAttribute('data-provider');
    assert.equal(Boolean(targetProvider), true, 'provider row should expose data-provider');

    await page.locator('.provider-hide').first().click();
    await page.waitForTimeout(250);
    const afterHideRows = await page.locator('#providerMatrixBody tr').count();
    assert.equal(afterHideRows < initialRows, true, 'hiding a provider row should reduce visible rows');

    await page.selectOption('#providerAddSelect', targetProvider);
    await page.click('#addProviderRow');
    await page.waitForFunction(
      ({ provider }) => Boolean(document.querySelector(`.provider-hide[data-provider="${provider}"]`)),
      { provider: targetProvider }
    );
    const afterAddRows = await page.locator('#providerMatrixBody tr').count();
    assert.equal(afterAddRows >= initialRows, true, 'adding provider row should restore visible provider');

    await page.close();
  }

  {
    const page = await browser.newPage();
    let startCalls = 0;
    let stopCalls = 0;
    const missionState = {
      id: 'mission-ui-test-1',
      sessionId: 'session-mission-ui-test-1',
      goal: 'ui mission goal',
      status: 'running',
      step: 1,
      maxSteps: 3,
      hardStepCap: 6,
      retries: 0,
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
            log: [{ ts: new Date().toISOString(), text: 'mission log entry' }],
            recentToolRuns: [],
            artifacts: []
          })
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/missions/start') {
        startCalls += 1;
        const payload = req.postDataJSON() || {};
        missionState.id = `mission-ui-${Date.now()}`;
        missionState.sessionId = `session-${missionState.id}`;
        missionState.goal = String(payload.goal || missionState.goal || 'ui mission goal');
        missionState.status = 'running';
        missionState.step = 0;
        missionState.maxSteps = Number(payload.maxSteps || 6);
        missionState.hardStepCap = Number(payload.maxSteps || 6);
        missionState.startedAt = new Date().toISOString();
        missionState.finishedAt = null;

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            id: missionState.id,
            sessionId: missionState.sessionId,
            status: missionState.status
          })
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/missions/stop') {
        stopCalls += 1;
        missionState.status = 'stopping';
        missionState.finishedAt = new Date().toISOString();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, id: missionState.id, status: missionState.status })
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

    const pickerOptions = await page.locator('#missionPicker option').allTextContents();
    assert.equal(pickerOptions.some((value) => value.includes('mission-ui-test-1')), true, 'existing missions should render in picker');

    await page.fill('#missionGoal', 'ui mission create flow');
    await page.click('#startMission');
    await waitForCondition(() => startCalls > 0, 10000);
    await page.waitForFunction(() => String(document.querySelector('#missionStatus')?.textContent || '').toLowerCase().includes('running'));

    const afterStart = await text(page, '#missionStatus');
    assert.equal(afterStart.toLowerCase().includes('running'), true, 'start mission should update mission status');

    await page.click('#refreshMission');
    await page.waitForFunction(() => String(document.querySelector('#missionTimelineSummary')?.textContent || '').includes('status=running'));
    const summary = await text(page, '#missionTimelineSummary');
    assert.equal(summary.includes('status=running'), true, 'mission timeline summary should show running mission state');

    await page.selectOption('#missionPicker', { index: 1 });
    await page.click('#loadMissionBtn');
    await page.waitForTimeout(200);

    await page.click('#stopMission');
    await waitForCondition(() => stopCalls > 0, 10000);
    await page.click('#refreshMission');
    await page.waitForFunction(() => String(document.querySelector('#missionTimelineSummary')?.textContent || '').includes('status=stopping'));
    const afterStop = await text(page, '#missionStatus');
    assert.equal(afterStop.toLowerCase().includes('stopping'), true, 'stop mission should update mission status');

    await page.close();
  }

  console.log('phase39.webui-interactions.e2e: ok');
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(proc);
}
