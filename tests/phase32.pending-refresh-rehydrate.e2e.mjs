import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer, stopServer } from './_helpers.mjs';
import { CDPBrowser } from '../src/browser/cdp.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);

function resolveChromeBin() {
  const candidates = ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function waitForCdp(port, deadlineMs = 15000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function launchHeadlessBrowser() {
  const chromeBin = resolveChromeBin();
  if (!chromeBin) {
    console.log('phase32 soft-skip: chromium not available');
    return null;
  }
  const port = 19444;
  const userDataDir = path.join(os.tmpdir(), `openunum-phase32-chrome-${Date.now()}`);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  const child = spawn(chromeBin, [
    '--headless=new',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-shm-usage',
    '--disable-features=Vulkan,UseSkiaRenderer',
    '--use-gl=swiftshader',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    'about:blank'
  ], { stdio: 'ignore' });
  const ready = await waitForCdp(port);
  if (!ready) {
    child.kill('SIGTERM');
    throw new Error('chromium CDP failed to start');
  }
  return { child, browser: new CDPBrowser(`http://127.0.0.1:${port}`), userDataDir };
}

async function stopHeadlessBrowser(handle) {
  if (!handle) return;
  try {
    handle.child.kill('SIGTERM');
  } catch {}
  fs.rmSync(handle.userDataDir, { recursive: true, force: true });
}

let proc;
let chrome;

try {
  proc = await startServer();
  chrome = await launchHeadlessBrowser();
  if (!chrome) process.exit(0);

  await chrome.browser.navigate(`http://127.0.0.1:${TEST_PORT}/`);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const install = await chrome.browser.evaluate(`(async () => {
    const session = 'phase32-ui-refresh';
    const startedAt = '2026-04-03T00:00:00.000Z';
    const userMessage = {
      role: 'user',
      content: 'refresh pending regression',
      created_at: '2026-04-03T00:00:00.000Z'
    };
    const assistantMessage = {
      role: 'assistant',
      content: 'Recovered final answer from pending run',
      html: '<p>Recovered final answer from pending run</p>',
      created_at: '2026-04-03T00:00:05.000Z'
    };
    let pendingChecks = 0;
    window.__phase32 = { pendingChecks: 0 };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const rawUrl = typeof input === 'string' ? input : input.url;
      const url = new URL(rawUrl, location.origin);
      if (url.pathname === '/api/sessions/' + encodeURIComponent(session) || url.pathname === '/api/sessions/' + session) {
        const messages = pendingChecks >= 2 ? [userMessage, assistantMessage] : [userMessage];
        return new Response(JSON.stringify({ sessionId: session, messages }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.pathname === '/api/sessions/' + session + '/activity') {
        return new Response(JSON.stringify({
          sessionId: session,
          since: url.searchParams.get('since') || null,
          pending: pendingChecks < 1,
          pendingStartedAt: startedAt,
          toolRuns: [{ toolName: 'http_request', args: { url: 'https://example.com' }, result: { ok: true } }],
          messages: pendingChecks >= 1 ? [assistantMessage] : []
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.pathname === '/api/chat/pending') {
        const pending = pendingChecks < 1;
        pendingChecks += 1;
        window.__phase32.pendingChecks = pendingChecks;
        return new Response(JSON.stringify({ ok: true, pending, sessionId: session, startedAt }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(input, init);
    };
    sessionId = session;
    localStorage.setItem('openunum_session', session);
    document.getElementById('chatMeta').textContent = session;
    loadSession(session);
    return { ok: true };
  })()`);
  assert.equal(install?.ok, true);

  await new Promise((resolve) => setTimeout(resolve, 400));
  const initial = await chrome.browser.evaluate(`(() => ({
    text: document.querySelector('.typing-status')?.textContent || '',
    livePanels: [...document.querySelectorAll('details[data-persist-key]')].map((el) => el.dataset.persistKey)
  }))()`);
  assert.equal(initial.text.includes('Executing tools') || initial.text.includes('Routing request'), true, 'pending status not rendered');
  assert.equal(initial.livePanels.some((key) => key.includes('live-retries')), true, 'retry panel missing');

  const opened = await chrome.browser.evaluate(`(() => {
    const retries = [...document.querySelectorAll('details[data-persist-key]')].find((el) => el.dataset.persistKey.includes('live-retries'));
    if (!retries) return { ok: false, error: 'retries_missing' };
    retries.open = true;
    retries.dispatchEvent(new Event('toggle'));
    const body = retries.querySelector('.trace-body');
    if (!body) return { ok: false, error: 'retries_body_missing' };
    body.scrollTop = 48;
    body.dispatchEvent(new Event('scroll'));
    const style = getComputedStyle(body);
    return {
      ok: true,
      key: retries.dataset.persistKey,
      scrollTop: body.scrollTop,
      overflowY: style.overflowY,
      maxHeight: style.maxHeight
    };
  })()`);
  assert.equal(opened?.ok, true, opened?.error || 'failed to open retries panel');
  assert.equal(opened.overflowY === 'auto' || opened.overflowY === 'scroll', true, 'retries panel is not scrollable');
  assert.equal(opened.maxHeight !== 'none', true, 'retries panel is missing max-height');

  await new Promise((resolve) => setTimeout(resolve, 2600));
  const persisted = await chrome.browser.evaluate(`(() => {
    const retries = [...document.querySelectorAll('details[data-persist-key]')].find((el) => el.dataset.persistKey.includes('live-retries'));
    const body = retries?.querySelector('.trace-body');
    return {
      exists: Boolean(retries),
      open: Boolean(retries?.open),
      scrollTop: Number(body?.scrollTop || 0),
      overflowY: body ? getComputedStyle(body).overflowY : '',
      status: document.querySelector('.typing-status')?.textContent || ''
    };
  })()`);
  assert.equal(persisted.exists, true, 'retries panel disappeared during rerender');
  assert.equal(persisted.open, true, 'retries panel did not preserve open state');
  assert.equal(persisted.overflowY === 'auto' || persisted.overflowY === 'scroll', true, 'retries panel lost scrollable styling');
  assert.equal(persisted.status.includes('Synthesizing answer') || persisted.status.includes('Executing tools'), true, 'unexpected mid-run status');

  await new Promise((resolve) => setTimeout(resolve, 2600));
  const finalState = await chrome.browser.evaluate(`(() => ({
    text: [...document.querySelectorAll('.bubble.ai')].at(-1)?.innerText || document.body.innerText,
    pendingChecks: window.__phase32?.pendingChecks || 0
  }))()`);
  assert.equal(finalState.pendingChecks >= 2, true, 'pending poll sequence did not advance');
  assert.equal(finalState.text.includes('Recovered final answer from pending run'), true, 'final reply was not restored');

  console.log('phase32.pending-refresh-rehydrate.e2e: ok');
} finally {
  await stopHeadlessBrowser(chrome);
  await stopServer(proc);
}
