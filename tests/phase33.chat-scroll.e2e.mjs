import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer, stopServer, jpost } from './_helpers.mjs';
import { CDPBrowser } from '../src/browser/cdp.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);

function resolveChromeBin() {
  const candidates = ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'];
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
    console.log('phase33 soft-skip: chromium not available');
    return null;
  }
  const port = 19445;
  const userDataDir = path.join(os.tmpdir(), `openunum-phase33-chrome-${Date.now()}`);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  const child = spawn(chromeBin, [
    '--headless=new',
    '--disable-gpu',
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

  const sessionId = `phase33-scroll-${Date.now()}`;
  const messages = Array.from({ length: 60 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index % 2 === 0 ? 'User' : 'Assistant'} message ${index + 1}: ` + 'long scroll payload '.repeat(35)
  }));
  const imported = await jpost('/api/sessions/import', { sessionId, messages });
  assert.equal(imported.status, 200);
  assert.equal(imported.json?.ok, true);

  await chrome.browser.navigate(`http://127.0.0.1:${TEST_PORT}/`);
  await new Promise((resolve) => setTimeout(resolve, 600));

  const loaded = await chrome.browser.evaluate(`(async () => {
    sessionId = ${JSON.stringify(sessionId)};
    localStorage.setItem('openunum_session', sessionId);
    document.getElementById('chatMeta').textContent = sessionId;
    await loadSession(sessionId);
    const chat = document.getElementById('chat');
    return {
      ok: Boolean(chat),
      scrollHeight: Number(chat?.scrollHeight || 0),
      clientHeight: Number(chat?.clientHeight || 0),
      scrollTop: Number(chat?.scrollTop || 0),
      bubbleCount: document.querySelectorAll('.bubble').length
    };
  })()`);
  assert.equal(loaded?.ok, true, 'chat container missing');
  assert.equal(loaded.bubbleCount >= 20, true, 'session did not render enough messages');
  assert.equal(loaded.scrollHeight > loaded.clientHeight, true, 'chat container is not overflowable');

  const scrolled = await chrome.browser.evaluate(`(() => {
    const chat = document.getElementById('chat');
    if (!chat) return { ok: false, error: 'chat_missing' };
    const before = Number(chat.scrollTop || 0);
    chat.scrollTop = 0;
    const top = Number(chat.scrollTop || 0);
    chat.scrollTop = Math.floor(chat.scrollHeight / 2);
    const mid = Number(chat.scrollTop || 0);
    return {
      ok: true,
      before,
      top,
      mid,
      overflowY: getComputedStyle(chat).overflowY,
      minHeight: getComputedStyle(chat).minHeight
    };
  })()`);
  assert.equal(scrolled?.ok, true, scrolled?.error || 'chat scroll operation failed');
  assert.equal(scrolled.overflowY === 'auto' || scrolled.overflowY === 'scroll', true, 'chat container is not scrollable');
  assert.equal(scrolled.mid > scrolled.top, true, 'chat scrollTop did not change');

  console.log('phase33.chat-scroll.e2e: ok');
} finally {
  await stopHeadlessBrowser(chrome);
  await stopServer(proc);
}
