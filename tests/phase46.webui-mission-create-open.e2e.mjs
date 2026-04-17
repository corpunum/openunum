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
  const mission = {
    id: 'mission-phase46',
    sessionId: 'mission-session-phase46',
    goal: 'phase46 mission goal',
    status: 'running',
    step: 1,
    maxSteps: 6,
    hardStepCap: 6,
    retries: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null
  };
  let missionStartCalls = 0;
  let missionStopCalls = 0;

  await page.route(/\/api\/missions(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();

    if (method === 'POST' && url.pathname === '/api/missions/start') {
      missionStartCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: mission.id, sessionId: mission.sessionId })
      });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/missions/stop') {
      missionStopCalls += 1;
      mission.status = 'stopping';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: mission.id, status: mission.status })
      });
      return;
    }
    if (method === 'GET' && url.pathname === '/api/missions') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ missions: [mission], schedules: [] })
      });
      return;
    }
    if (method === 'GET' && url.pathname === '/api/missions/status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mission })
      });
      return;
    }
    if (method === 'GET' && url.pathname === '/api/missions/timeline') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mission,
          log: [{ step: 1, at: new Date().toISOString(), reply: 'phase46 log line' }],
          toolRuns: [{ toolName: 'phase46-tool', ok: true, createdAt: new Date().toISOString(), result: { ok: true } }],
          recentStrategies: [],
          compactions: [],
          artifacts: [{ type: 'note', content: 'phase46 artifact', sourceRef: 'phase46' }]
        })
      });
      return;
    }
    await route.continue();
  });

  await page.route(new RegExp(`/api/sessions/${mission.sessionId.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:/activity)?(?:\\?.*)?$`), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET' && url.pathname.endsWith('/activity')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: mission.sessionId,
          pending: false,
          pendingStartedAt: null,
          toolRuns: [],
          messages: [{ role: 'assistant', content: 'mission session assistant reply', html: '<p>mission session assistant reply</p>', created_at: new Date().toISOString() }]
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: mission.sessionId,
        messages: [{ role: 'assistant', content: 'mission session assistant reply', html: '<p>mission session assistant reply</p>', created_at: new Date().toISOString() }]
      })
    });
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.locator('summary', { hasText: 'Settings' }).click();
  await page.click('.menu-btn[data-view="missions"]');
  await page.waitForSelector('#missionGoal', { timeout: 15000 });

  await page.fill('#missionGoal', mission.goal);
  await page.click('#startMission');
  await waitForCondition(async () => missionStartCalls > 0, 8000);

  await waitForCondition(async () => {
    const options = await page.$$eval('#missionPicker option', (els) => els.map((el) => el.value));
    return options.includes(mission.id);
  }, 10000);

  await page.selectOption('#missionPicker', mission.id);
  await page.click('#loadMissionBtn');
  await waitForCondition(async () => {
    const summary = String(await page.locator('#missionTimelineSummary').textContent() || '');
    return summary.includes('status=running') && summary.includes(mission.sessionId);
  }, 10000);

  await page.click('#openMissionSessionBtn');
  await waitForCondition(async () => {
    const chatMeta = String(await page.locator('#chatMeta').textContent() || '');
    return chatMeta.includes(mission.sessionId);
  }, 10000);

  await page.click('.menu-btn[data-view="missions"]');
  await page.waitForSelector('#view-missions.active', { timeout: 10000 });
  await page.waitForSelector('#stopMission', { state: 'visible', timeout: 10000 });
  await page.click('#stopMission');
  await waitForCondition(async () => missionStopCalls > 0, 8000);

  await page.close();
  console.log('phase46.webui-mission-create-open.e2e: ok');
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(proc);
}
