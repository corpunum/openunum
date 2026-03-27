import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { loadConfig, saveConfig } from './config.mjs';
import { MemoryStore } from './memory/store.mjs';
import { OpenUnumAgent } from './core/agent.mjs';
import { CDPBrowser } from './browser/cdp.mjs';
import { TelegramChannel } from './channels/telegram.mjs';
import { logInfo, logError } from './logger.mjs';

const config = loadConfig();
const memory = new MemoryStore();
const agent = new OpenUnumAgent({ config, memoryStore: memory });
let browser = new CDPBrowser(config.browser?.cdpUrl);
let telegramLoopRunning = false;
let telegramLoopStopRequested = false;
let telegramLoopPromise = null;

function renderReplyHtml(text) {
  const raw = marked.parse(text || '');
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'pre', 'code']),
    allowedAttributes: {
      a: ['href', 'name', 'target'],
      img: ['src', 'alt']
    },
    allowedSchemes: ['http', 'https', 'mailto']
  });
}

async function runTelegramLoop() {
  if (!config.channels.telegram?.botToken) {
    throw new Error('Missing Telegram bot token');
  }
  if (telegramLoopRunning) return;
  telegramLoopStopRequested = false;
  telegramLoopRunning = true;
  const tg = new TelegramChannel(config.channels.telegram, async (text, sessionId) => {
    const out = await agent.chat({ message: text, sessionId });
    return out.reply;
  });
  telegramLoopPromise = (async () => {
    while (!telegramLoopStopRequested) {
      try {
        await tg.pollOnce();
      } catch (error) {
        logError('telegram_poll_error', { error: String(error.message || error) });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    telegramLoopRunning = false;
  })();
}

async function stopTelegramLoop() {
  telegramLoopStopRequested = true;
  if (telegramLoopPromise) {
    await Promise.race([telegramLoopPromise, new Promise((r) => setTimeout(r, 3000))]);
  }
  telegramLoopRunning = false;
}

function resolveChromeBin() {
  const candidates = ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function launchDebugBrowser() {
  const chromeBin = resolveChromeBin();
  if (!chromeBin) {
    throw new Error('No Chromium/Chrome executable found on host');
  }
  const port = 9333;
  const args = [
    `--remote-debugging-port=${port}`,
    '--user-data-dir=/tmp/openunum-chrome-debug',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--headless=new',
    'about:blank'
  ];
  const child = spawn(chromeBin, args, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  config.browser.cdpUrl = `http://127.0.0.1:${port}`;
  saveConfig(config);
  browser = new CDPBrowser(config.browser.cdpUrl);
  return { ok: true, cdpUrl: config.browser.cdpUrl, pid: child.pid };
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      return sendJson(res, 200, { ok: true, service: 'openunum' });
    }

    if (req.method === 'GET' && url.pathname === '/api/model/current') {
      return sendJson(res, 200, agent.getCurrentModel());
    }

    if (req.method === 'POST' && url.pathname === '/api/model/switch') {
      const body = await parseBody(req);
      const out = agent.switchModel(body.provider, body.model);
      saveConfig(config);
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await parseBody(req);
      const out = await agent.chat({ message: body.message, sessionId: body.sessionId });
      return sendJson(res, 200, { ...out, replyHtml: renderReplyHtml(out.reply) });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
      const sessionId = url.pathname.split('/').pop();
      const msgs = memory.getMessages(sessionId || '', 100);
      return sendJson(res, 200, { sessionId, messages: msgs });
    }

    if (req.method === 'GET' && url.pathname === '/api/browser/status') {
      const out = await browser.status();
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/browser/config') {
      return sendJson(res, 200, { cdpUrl: config.browser?.cdpUrl || 'http://127.0.0.1:9222' });
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/config') {
      const body = await parseBody(req);
      if (!config.browser) config.browser = {};
      if (typeof body.cdpUrl === 'string' && body.cdpUrl.trim()) {
        config.browser.cdpUrl = body.cdpUrl.trim();
      }
      saveConfig(config);
      browser = new CDPBrowser(config.browser.cdpUrl);
      return sendJson(res, 200, { ok: true, cdpUrl: config.browser.cdpUrl });
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/launch') {
      const out = await launchDebugBrowser();
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/telegram/config') {
      const tg = config.channels.telegram || { botToken: '', enabled: false };
      return sendJson(res, 200, { enabled: Boolean(tg.enabled), hasToken: Boolean(tg.botToken) });
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram/config') {
      const body = await parseBody(req);
      const tg = config.channels.telegram || {};
      if (typeof body.botToken === 'string') tg.botToken = body.botToken.trim();
      if (typeof body.enabled === 'boolean') tg.enabled = body.enabled;
      config.channels.telegram = tg;
      saveConfig(config);
      return sendJson(res, 200, { ok: true, enabled: Boolean(tg.enabled), hasToken: Boolean(tg.botToken) });
    }

    if (req.method === 'GET' && url.pathname === '/api/telegram/status') {
      return sendJson(res, 200, { running: telegramLoopRunning, stopRequested: telegramLoopStopRequested });
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram/start') {
      await runTelegramLoop();
      return sendJson(res, 200, { ok: true, running: telegramLoopRunning });
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram/stop') {
      await stopTelegramLoop();
      return sendJson(res, 200, { ok: true, running: telegramLoopRunning });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(process.cwd(), 'src/ui/index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  } catch (error) {
    logError('request_failed', { error: String(error.message || error) });
    sendJson(res, 500, { error: String(error.message || error) });
  }
});

server.listen(config.server.port, config.server.host, () => {
  logInfo('openunum_server_started', { host: config.server.host, port: config.server.port });
});
