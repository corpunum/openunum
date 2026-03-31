import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { loadConfig, saveConfig, defaultConfig } from './config.mjs';
import { MemoryStore } from './memory/store.mjs';
import { OpenUnumAgent } from './core/agent.mjs';
import { MissionRunner } from './core/missions.mjs';
import { SelfHealMonitor } from './core/selfheal.mjs';
import { getAutonomyMaster } from './core/autonomy-master.mjs';
import { CDPBrowser } from './browser/cdp.mjs';
import { TelegramChannel } from './channels/telegram.mjs';
import { logInfo, logError } from './logger.mjs';
import {
  fetchNvidiaModels,
  fetchOllamaModels,
  fetchOpenRouterModels,
  importProviderSecretsFromOpenClaw
} from './models/catalog.mjs';

const config = loadConfig();
const memory = new MemoryStore();
const agent = new OpenUnumAgent({ config, memoryStore: memory });
const missions = new MissionRunner({ agent, memoryStore: memory, config });
let browser = new CDPBrowser(config.browser?.cdpUrl);
const autonomyMaster = getAutonomyMaster({ config, agent, memoryStore: memory, browser });
const selfHealMonitor = new SelfHealMonitor({ config, agent, browser, memory });
let telegramLoopRunning = false;
let telegramLoopStopRequested = false;
let telegramLoopPromise = null;
const pendingChats = new Map();
let researchDailyTimer = null;

function applyAutonomyMode(mode) {
  const m = String(mode || 'standard').toLowerCase();
  if (m === 'relentless') {
    config.runtime.autonomyMode = 'relentless';
    config.runtime.shellEnabled = true;
    config.runtime.maxToolIterations = 20;
    config.runtime.executorRetryAttempts = 6;
    config.runtime.executorRetryBackoffMs = 900;
    config.runtime.missionDefaultContinueUntilDone = true;
    config.runtime.missionDefaultHardStepCap = 300;
    config.runtime.missionDefaultMaxRetries = 8;
    config.runtime.missionDefaultIntervalMs = 250;
    config.model.routing.forcePrimaryProvider = true;
    config.model.routing.fallbackEnabled = false;
    config.model.routing.fallbackProviders = [config.model.provider];
    if (config.runtime.autonomyMasterAutoStart) autonomyMaster.start();
    return 'relentless';
  }

  config.runtime.autonomyMode = 'standard';
  config.runtime.maxToolIterations = 8;
  config.runtime.executorRetryAttempts = 3;
  config.runtime.executorRetryBackoffMs = 700;
  config.runtime.missionDefaultContinueUntilDone = true;
  config.runtime.missionDefaultHardStepCap = 120;
  config.runtime.missionDefaultMaxRetries = 3;
  config.runtime.missionDefaultIntervalMs = 400;
  if (!config.model.routing.fallbackProviders?.length) {
    config.model.routing.fallbackProviders = [config.model.provider];
  }
  autonomyMaster.stop();
  return 'standard';
}

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
  // Kill stale debug instances so a new visible window can be created reliably.
  try {
    spawn('pkill', ['-f', 'openunum-chrome-debug'], { stdio: 'ignore' });
  } catch {
    // ignore best-effort cleanup errors
  }

  const args = [
    `--remote-debugging-port=${port}`,
    '--user-data-dir=/tmp/openunum-chrome-debug',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--new-window',
    'about:blank'
  ];
  const child = spawn(chromeBin, args, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  // Verify endpoint is actually up before reporting success.
  let ready = false;
  for (let i = 0; i < 20; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!ready) {
    return {
      ok: false,
      error: 'debug_browser_not_ready',
      hint: 'Chromium did not expose CDP on port 9333 after launch.'
    };
  }

  config.browser.cdpUrl = `http://127.0.0.1:${port}`;
  saveConfig(config);
  browser = new CDPBrowser(config.browser.cdpUrl);
  agent.reloadTools();
  return { ok: true, cdpUrl: config.browser.cdpUrl, pid: child.pid };
}

function msUntilNextHour(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(Number(hour));
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(60 * 1000, next.getTime() - now.getTime());
}

function stopResearchDailyLoop() {
  if (researchDailyTimer) {
    clearTimeout(researchDailyTimer);
    researchDailyTimer = null;
  }
}

function startResearchDailyLoop() {
  stopResearchDailyLoop();
  if (!config.runtime?.researchDailyEnabled) return;
  const run = async () => {
    try {
      await agent.runTool('research_run_daily', { simulate: false });
      logInfo('research_daily_completed', {});
    } catch (error) {
      logError('research_daily_failed', { error: String(error.message || error) });
    } finally {
      researchDailyTimer = setTimeout(run, msUntilNextHour(config.runtime.researchScheduleHour ?? 3));
    }
  };
  researchDailyTimer = setTimeout(run, msUntilNextHour(config.runtime.researchScheduleHour ?? 3));
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function withTimeout(promise, timeoutMs, timeoutMessage = 'operation_timeout') {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
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

async function runHealthCheck() {
  // Use the SelfHealMonitor for comprehensive health checks
  const result = await selfHealMonitor.runFullHealthCheck();
  return result;
}

async function runSelfHeal(dryRun = false) {
  const actions = [];
  const results = [];

  // Action 1: Check and fix config
  try {
    const cfg = loadConfig();
    if (!cfg.runtime) {
      actions.push({ action: 'fix_config_runtime', status: dryRun ? 'pending' : 'applied' });
      if (!dryRun) {
        cfg.runtime = defaultConfig().runtime;
        saveConfig(cfg);
      }
      results.push({ action: 'fix_config_runtime', success: true });
    } else {
      results.push({ action: 'config_ok', success: true });
    }
  } catch (error) {
    actions.push({ action: 'rebuild_config', status: dryRun ? 'pending' : 'applied' });
    if (!dryRun) {
      const newCfg = defaultConfig();
      saveConfig(newCfg);
    }
    results.push({ action: 'rebuild_config', success: true });
  }

  // Action 2: Check browser CDP
  try {
    const status = await browser.status();
    if (!status.ok) {
      actions.push({ action: 'browser_cdp_unhealthy', status: 'needs_attention', details: status });
      results.push({ action: 'browser_cdp_unhealthy', success: false, hint: 'Try /api/browser/launch' });
    } else {
      results.push({ action: 'browser_ok', success: true });
    }
  } catch (error) {
    actions.push({ action: 'browser_cdp_error', status: 'error', error: String(error.message || error) });
    results.push({ action: 'browser_cdp_error', success: false, hint: 'Check CDP URL in config' });
  }

  // Action 3: Check disk space
  try {
    const home = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
    const dfOut = execSync(`df -h "${home}" 2>/dev/null || df -h /`, { encoding: 'utf8' });
    const lines = dfOut.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const usePercent = parseInt(parts[4] || '0', 10);
      if (usePercent >= 90) {
        actions.push({ action: 'disk_space_critical', usedPercent: usePercent, status: 'warning' });
        results.push({ action: 'disk_space_critical', success: false, hint: 'Free up disk space' });
      } else {
        results.push({ action: 'disk_space_ok', usedPercent: usePercent, success: true });
      }
    }
  } catch {
    results.push({ action: 'disk_check_skipped', success: true });
  }

  // Action 4: Check pending chats
  const pendingCount = pendingChats.size;
  if (pendingCount > 10) {
    actions.push({ action: 'pending_chats_high', count: pendingCount, status: 'warning' });
    results.push({ action: 'pending_chats_high', success: false, hint: 'Wait for chats to complete or restart server' });
  } else {
    results.push({ action: 'pending_chats_ok', count: pendingCount, success: true });
  }

  // Action 5: Reload agent tools if config changed
  if (actions.some(a => a.action.includes('config'))) {
    actions.push({ action: 'reload_agent_tools', status: dryRun ? 'pending' : 'applied' });
    if (!dryRun) {
      agent.reloadTools();
    }
    results.push({ action: 'reload_agent_tools', success: !dryRun });
  }

  return { ok: results.every(r => r.success !== false), actions, results, dryRun };
}

function getOrStartChat(sessionId, message) {
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('sessionId is required');
  const existing = pendingChats.get(sid);
  if (existing) return existing;
  const startedAt = new Date().toISOString();
  const promise = agent.chat({ message, sessionId: sid })
    .then((out) => {
      saveConfig(config);
      return out;
    })
    .finally(() => {
      pendingChats.delete(sid);
    });
  const entry = { sessionId: sid, message, startedAt, promise };
  pendingChats.set(sid, entry);
  return entry;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      const health = await runHealthCheck();
      return sendJson(res, 200, {
        ok: true,
        service: 'openunum',
        health
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/self-heal') {
      const dryRun = url.searchParams.get('dryRun') !== 'false';
      const result = await runSelfHeal(dryRun);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/self-heal') {
      const body = await parseBody(req);
      const dryRun = body.dryRun !== false;
      const result = await runSelfHeal(dryRun);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/self-heal/fix') {
      const result = await runSelfHeal(false);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/health/check') {
      const health = await runHealthCheck();
      return sendJson(res, health.ok ? 200 : 503, health);
    }

    if (req.method === 'POST' && url.pathname === '/api/selfheal/run') {
      const body = await parseBody(req);
      const dryRun = Boolean(body?.dryRun);
      const result = await runSelfHeal(dryRun);
      if (!dryRun && result.ok) {
        logInfo('selfheal_executed', { actions: result.actions.length, results: result.results.length });
      }
      return sendJson(res, result.ok ? 200 : 500, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/selfheal/status') {
      const status = {
        ok: true,
        uptime: process.uptime(),
        pendingChats: pendingChats.size,
        telegramRunning: telegramLoopRunning,
        config: {
          autonomyMode: config.runtime.autonomyMode,
          shellEnabled: config.runtime.shellEnabled,
          maxToolIterations: config.runtime.maxToolIterations
        },
        model: agent.getCurrentModel(),
        browser: { cdpUrl: config.browser?.cdpUrl },
        timestamp: new Date().toISOString()
      };
      return sendJson(res, 200, status);
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(res, 200, {
        model: config.model,
        runtime: config.runtime,
        research: config.research,
        integrations: config.integrations,
        browser: config.browser,
        channels: { telegram: { enabled: Boolean(config.channels?.telegram?.enabled), hasToken: Boolean(config.channels?.telegram?.botToken) } }
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/config') {
      const body = await parseBody(req);
      if (body.runtime && typeof body.runtime.shellEnabled === 'boolean') {
        config.runtime.shellEnabled = body.runtime.shellEnabled;
      }
      if (body.runtime && typeof body.runtime.workspaceRoot === 'string' && body.runtime.workspaceRoot.trim()) {
        config.runtime.workspaceRoot = body.runtime.workspaceRoot.trim();
      }
      if (body.runtime && typeof body.runtime.ownerControlMode === 'string' && body.runtime.ownerControlMode.trim()) {
        config.runtime.ownerControlMode = body.runtime.ownerControlMode.trim();
      }
      if (body.runtime && typeof body.runtime.selfPokeEnabled === 'boolean') {
        config.runtime.selfPokeEnabled = body.runtime.selfPokeEnabled;
      }
      if (body.runtime && Number.isFinite(body.runtime.toolCircuitFailureThreshold)) {
        config.runtime.toolCircuitFailureThreshold = Number(body.runtime.toolCircuitFailureThreshold);
      }
      if (body.runtime && Number.isFinite(body.runtime.toolCircuitCooldownMs)) {
        config.runtime.toolCircuitCooldownMs = Number(body.runtime.toolCircuitCooldownMs);
      }
      if (body.runtime && typeof body.runtime.autonomyMasterAutoStart === 'boolean') {
        config.runtime.autonomyMasterAutoStart = body.runtime.autonomyMasterAutoStart;
      }
      if (body.runtime && typeof body.runtime.researchDailyEnabled === 'boolean') {
        config.runtime.researchDailyEnabled = body.runtime.researchDailyEnabled;
      }
      if (body.runtime && Number.isFinite(body.runtime.researchScheduleHour)) {
        config.runtime.researchScheduleHour = Number(body.runtime.researchScheduleHour);
      }
      if (body.runtime && typeof body.runtime.contextCompactionEnabled === 'boolean') {
        config.runtime.contextCompactionEnabled = body.runtime.contextCompactionEnabled;
      }
      if (body.runtime && Number.isFinite(body.runtime.contextCompactTriggerPct)) {
        config.runtime.contextCompactTriggerPct = Number(body.runtime.contextCompactTriggerPct);
      }
      if (body.runtime && Number.isFinite(body.runtime.contextCompactTargetPct)) {
        config.runtime.contextCompactTargetPct = Number(body.runtime.contextCompactTargetPct);
      }
      if (body.runtime && Number.isFinite(body.runtime.contextHardFailPct)) {
        config.runtime.contextHardFailPct = Number(body.runtime.contextHardFailPct);
      }
      if (body.runtime && Number.isFinite(body.runtime.contextProtectRecentTurns)) {
        config.runtime.contextProtectRecentTurns = Number(body.runtime.contextProtectRecentTurns);
      }
      if (body.runtime && Number.isFinite(body.runtime.contextFallbackTokens)) {
        config.runtime.contextFallbackTokens = Number(body.runtime.contextFallbackTokens);
      }
      if (body.runtime && Number.isFinite(body.runtime.maxToolIterations)) {
        config.runtime.maxToolIterations = Number(body.runtime.maxToolIterations);
      }
      if (body.runtime && Number.isFinite(body.runtime.executorRetryAttempts)) {
        config.runtime.executorRetryAttempts = Number(body.runtime.executorRetryAttempts);
      }
      if (body.runtime && Number.isFinite(body.runtime.executorRetryBackoffMs)) {
        config.runtime.executorRetryBackoffMs = Number(body.runtime.executorRetryBackoffMs);
      }
      if (body.runtime && typeof body.runtime.autonomyMode === 'string') {
        config.runtime.autonomyMode = body.runtime.autonomyMode;
      }
      if (body.runtime && typeof body.runtime.missionDefaultContinueUntilDone === 'boolean') {
        config.runtime.missionDefaultContinueUntilDone = body.runtime.missionDefaultContinueUntilDone;
      }
      if (body.runtime && Number.isFinite(body.runtime.missionDefaultHardStepCap)) {
        config.runtime.missionDefaultHardStepCap = Number(body.runtime.missionDefaultHardStepCap);
      }
      if (body.runtime && Number.isFinite(body.runtime.missionDefaultMaxRetries)) {
        config.runtime.missionDefaultMaxRetries = Number(body.runtime.missionDefaultMaxRetries);
      }
      if (body.runtime && Number.isFinite(body.runtime.missionDefaultIntervalMs)) {
        config.runtime.missionDefaultIntervalMs = Number(body.runtime.missionDefaultIntervalMs);
      }
      if (body.model && typeof body.model.provider === 'string' && body.model.provider.trim()) {
        config.model.provider = body.model.provider.trim().toLowerCase();
      }
      if (body.model && typeof body.model.model === 'string' && body.model.model.trim()) {
        config.model.model = body.model.model.trim();
        config.model.providerModels = config.model.providerModels || {};
        config.model.providerModels[config.model.provider] = config.model.model;
      }
      if (body.model && body.model.routing) {
        config.model.routing = { ...config.model.routing, ...body.model.routing };
      }
      if (body.integrations?.googleWorkspace && typeof body.integrations.googleWorkspace.cliCommand === 'string') {
        config.integrations.googleWorkspace.cliCommand = body.integrations.googleWorkspace.cliCommand.trim() || 'gws';
      }
      saveConfig(config);
      agent.reloadTools();
      if (config.runtime.researchDailyEnabled) startResearchDailyLoop();
      else stopResearchDailyLoop();
      return sendJson(res, 200, { ok: true, runtime: config.runtime });
    }

    if (req.method === 'GET' && url.pathname === '/api/autonomy/mode') {
      return sendJson(res, 200, {
        mode: config.runtime.autonomyMode || 'standard',
        runtime: config.runtime,
        routing: config.model.routing
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/mode') {
      const body = await parseBody(req);
      const mode = applyAutonomyMode(body.mode);
      saveConfig(config);
      agent.reloadTools();
      return sendJson(res, 200, {
        ok: true,
        mode,
        runtime: config.runtime,
        routing: config.model.routing
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/autonomy/master/status') {
      return sendJson(res, 200, { ok: true, status: autonomyMaster.getStatus() });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/start') {
      const started = autonomyMaster.start();
      return sendJson(res, 200, { ok: true, started, status: autonomyMaster.getStatus() });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/stop') {
      const stopped = autonomyMaster.stop();
      return sendJson(res, 200, { ok: true, stopped, status: autonomyMaster.getStatus() });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/cycle') {
      const out = await autonomyMaster.runCycle();
      return sendJson(res, 200, { ok: true, result: out });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/self-improve') {
      const out = await autonomyMaster.selfImprove();
      return sendJson(res, 200, { ok: true, result: out });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/learn-skills') {
      const out = await autonomyMaster.learnSkills();
      return sendJson(res, 200, { ok: true, result: out });
    }

    if (req.method === 'POST' && url.pathname === '/api/autonomy/master/self-test') {
      const out = await autonomyMaster.fullSelfTest();
      return sendJson(res, 200, { ok: true, result: out });
    }

    if (req.method === 'GET' && url.pathname === '/api/providers/config') {
      return sendJson(res, 200, {
        ollamaBaseUrl: config.model.ollamaBaseUrl,
        openrouterBaseUrl: config.model.openrouterBaseUrl,
        nvidiaBaseUrl: config.model.nvidiaBaseUrl,
        genericBaseUrl: config.model.genericBaseUrl,
        hasOpenrouterApiKey: Boolean(config.model.openrouterApiKey),
        hasNvidiaApiKey: Boolean(config.model.nvidiaApiKey),
        hasGenericApiKey: Boolean(config.model.genericApiKey)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/providers/config') {
      const body = await parseBody(req);
      const up = body || {};
      if (typeof up.ollamaBaseUrl === 'string') config.model.ollamaBaseUrl = up.ollamaBaseUrl.trim();
      if (typeof up.openrouterBaseUrl === 'string') config.model.openrouterBaseUrl = up.openrouterBaseUrl.trim();
      if (typeof up.nvidiaBaseUrl === 'string') config.model.nvidiaBaseUrl = up.nvidiaBaseUrl.trim();
      if (typeof up.genericBaseUrl === 'string') config.model.genericBaseUrl = up.genericBaseUrl.trim();
      if (typeof up.openrouterApiKey === 'string') config.model.openrouterApiKey = up.openrouterApiKey.trim();
      if (typeof up.nvidiaApiKey === 'string') config.model.nvidiaApiKey = up.nvidiaApiKey.trim();
      if (typeof up.genericApiKey === 'string') config.model.genericApiKey = up.genericApiKey.trim();
      saveConfig(config);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/providers/import-openclaw') {
      const imported = importProviderSecretsFromOpenClaw();
      if (imported.openrouterApiKey) config.model.openrouterApiKey = imported.openrouterApiKey;
      if (imported.nvidiaApiKey) config.model.nvidiaApiKey = imported.nvidiaApiKey;
      if (imported.openrouterBaseUrl) config.model.openrouterBaseUrl = imported.openrouterBaseUrl;
      if (imported.nvidiaBaseUrl) config.model.nvidiaBaseUrl = imported.nvidiaBaseUrl;
      saveConfig(config);
      return sendJson(res, 200, {
        ok: true,
        imported: {
          openrouterApiKey: Boolean(imported.openrouterApiKey),
          nvidiaApiKey: Boolean(imported.nvidiaApiKey),
          openrouterBaseUrl: imported.openrouterBaseUrl || config.model.openrouterBaseUrl,
          nvidiaBaseUrl: imported.nvidiaBaseUrl || config.model.nvidiaBaseUrl
        }
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/models') {
      const provider = (url.searchParams.get('provider') || config.model.provider || 'ollama').toLowerCase();
      if (provider === 'ollama') {
        const models = await fetchOllamaModels(config.model.ollamaBaseUrl);
        return sendJson(res, 200, { provider, models });
      }
      if (provider === 'openrouter') {
        const models = await fetchOpenRouterModels(config.model.openrouterBaseUrl, config.model.openrouterApiKey);
        return sendJson(res, 200, { provider, models });
      }
      if (provider === 'nvidia') {
        const models = await fetchNvidiaModels(config.model.nvidiaBaseUrl, config.model.nvidiaApiKey);
        return sendJson(res, 200, { provider, models });
      }
      return sendJson(res, 400, { error: `unsupported_provider:${provider}` });
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
      const sessionId = String(body.sessionId || '').trim();
      const message = String(body.message || '').trim();
      if (!sessionId) return sendJson(res, 400, { error: 'sessionId is required' });
      if (!message) return sendJson(res, 400, { error: 'message is required' });

      const existing = pendingChats.get(sessionId);
      if (existing) {
        return sendJson(res, 202, {
          ok: true,
          pending: true,
          sessionId,
          startedAt: existing.startedAt,
          note: 'chat_already_running_for_session'
        });
      }

      const entry = getOrStartChat(sessionId, message);
      try {
        const out = await withTimeout(entry.promise, 20 * 1000, 'chat_timeout');
        return sendJson(res, 200, { ...out, replyHtml: renderReplyHtml(out.reply) });
      } catch (error) {
        if (String(error.message || error) === 'chat_timeout') {
          return sendJson(res, 202, {
            ok: true,
            pending: true,
            sessionId,
            startedAt: entry.startedAt,
            note: 'chat_still_running'
          });
        }
        throw error;
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/chat/pending') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      if (!sessionId) return sendJson(res, 400, { error: 'sessionId is required' });
      const existing = pendingChats.get(sessionId);
      if (!existing) return sendJson(res, 200, { ok: true, pending: false, sessionId });
      return sendJson(res, 200, {
        ok: true,
        pending: true,
        sessionId,
        startedAt: existing.startedAt
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/tool/run') {
      const body = await parseBody(req);
      const out = await agent.runTool(body.name, body.args || {});
      return sendJson(res, 200, { ok: true, result: out });
    }

    if (req.method === 'GET' && url.pathname === '/api/context/status') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const out = agent.getContextStatus(sessionId);
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/context/compact') {
      const body = await parseBody(req);
      const out = agent.compactSessionContext({
        sessionId: body.sessionId,
        dryRun: Boolean(body.dryRun)
      });
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/context/compactions') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const limit = Number(url.searchParams.get('limit') || 20);
      const out = agent.listContextCompactions(sessionId, limit);
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/context/artifacts') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const limit = Number(url.searchParams.get('limit') || 40);
      const out = agent.listContextArtifacts(sessionId, limit);
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/skills') {
      const out = await agent.runTool('skill_list', {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/install') {
      const body = await parseBody(req);
      const out = await agent.runTool('skill_install', body || {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/review') {
      const body = await parseBody(req);
      const out = await agent.runTool('skill_review', { name: body.name });
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/approve') {
      const body = await parseBody(req);
      const out = await agent.runTool('skill_approve', { name: body.name });
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/execute') {
      const body = await parseBody(req);
      const out = await agent.runTool('skill_execute', { name: body.name, args: body.args || {} });
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/uninstall') {
      const body = await parseBody(req);
      const out = await agent.runTool('skill_uninstall', { name: body.name });
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/email/status') {
      const out = await agent.runTool('email_status', {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/email/send') {
      const body = await parseBody(req);
      const out = await agent.runTool('email_send', body || {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/email/list') {
      const body = await parseBody(req);
      const out = await agent.runTool('email_list', body || {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/email/read') {
      const body = await parseBody(req);
      const out = await agent.runTool('email_read', body || {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/gworkspace/call') {
      const body = await parseBody(req);
      const out = await agent.runTool('gworkspace_call', body || {});
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/research/run') {
      const body = await parseBody(req);
      const out = await agent.runTool('research_run_daily', { simulate: Boolean(body?.simulate) });
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/research/recent') {
      const out = await agent.runTool('research_list_recent', {
        limit: Number(url.searchParams.get('limit') || 10)
      });
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname === '/api/research/queue') {
      const out = await agent.runTool('research_review_queue', {
        limit: Number(url.searchParams.get('limit') || 50)
      });
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/research/approve') {
      const body = await parseBody(req);
      const out = await agent.runTool('research_approve', {
        url: String(body?.url || ''),
        note: String(body?.note || '')
      });
      return sendJson(res, 200, out);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
      if (url.pathname.endsWith('/activity')) {
        const parts = url.pathname.split('/');
        const sessionId = decodeURIComponent(parts[3] || '');
        const since = String(url.searchParams.get('since') || '');
        const pending = pendingChats.get(sessionId);
        const toolRuns = memory.getToolRunsSince(sessionId, since, 80);
        const messages = memory.getMessagesSince(sessionId, since, 80);
        return sendJson(res, 200, {
          sessionId,
          since: since || null,
          pending: Boolean(pending),
          pendingStartedAt: pending?.startedAt || null,
          toolRuns,
          messages
        });
      }
      const sessionId = decodeURIComponent(url.pathname.split('/').pop() || '');
      const msgs = memory.getMessages(sessionId || '', 100)
        .map((m) => ({
          ...m,
          html: m.role === 'assistant' ? renderReplyHtml(m.content || '') : null
        }));
      return sendJson(res, 200, { sessionId, messages: msgs });
    }

    if (req.method === 'GET' && url.pathname === '/api/missions') {
      return sendJson(res, 200, { missions: missions.list() });
    }

    if (req.method === 'GET' && url.pathname === '/api/missions/status') {
      const id = url.searchParams.get('id') || '';
      const mission = missions.get(id);
      if (!mission) return sendJson(res, 404, { error: 'mission_not_found' });
      return sendJson(res, 200, { mission });
    }

    if (req.method === 'POST' && url.pathname === '/api/missions/start') {
      const body = await parseBody(req);
      const out = missions.start({
        goal: body.goal,
        maxSteps: body.maxSteps,
        intervalMs: body.intervalMs ?? config.runtime.missionDefaultIntervalMs,
        maxRetries: body.maxRetries ?? config.runtime.missionDefaultMaxRetries,
        continueUntilDone: body.continueUntilDone ?? config.runtime.missionDefaultContinueUntilDone,
        hardStepCap: body.hardStepCap ?? config.runtime.missionDefaultHardStepCap
      });
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/missions/stop') {
      const body = await parseBody(req);
      return sendJson(res, 200, missions.stop(body.id));
    }

    if (req.method === 'GET' && url.pathname === '/api/browser/status') {
      const out = await browser.status();
      return sendJson(res, 200, out);
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/navigate') {
      const body = await parseBody(req);
      return sendJson(res, 200, await browser.navigate(body.url));
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/search') {
      const body = await parseBody(req);
      return sendJson(res, 200, await browser.search(body.query));
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/extract') {
      const body = await parseBody(req);
      return sendJson(res, 200, await browser.extractText(body.selector || 'body'));
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
      agent.reloadTools();
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
  if (config.runtime?.autonomyMasterAutoStart) {
    autonomyMaster.start();
  }
  if (config.runtime?.researchDailyEnabled) {
    startResearchDailyLoop();
  }
});
