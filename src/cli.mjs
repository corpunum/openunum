#!/usr/bin/env node
import { loadConfig, saveConfig } from './config.mjs';
import { MemoryStore } from './memory/store.mjs';
import { OpenUnumAgent } from './core/agent.mjs';
import { CDPBrowser } from './browser/cdp.mjs';
import { TelegramChannel } from './channels/telegram.mjs';
import { loadBuiltinCommands } from './commands/loader.mjs';
import { getRegistry } from './commands/registry.mjs';
import { PROVIDER_ORDER, normalizeProviderId } from './models/catalog.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const config = loadConfig();
let memory = null;
let agent = null;
let registry = null;

function getAgentContext() {
  if (agent && memory && registry) {
    return { memory, agent, registry };
  }
  memory = new MemoryStore();
  agent = new OpenUnumAgent({ config, memoryStore: memory });
  loadBuiltinCommands();
  registry = getRegistry();
  return { memory, agent, registry };
}

function getArg(name, fallback = '') {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args[i + 1] ?? fallback;
}

function getArgNumber(name, fallback = null) {
  const raw = getArg(name, '');
  if (raw === '' || raw == null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const API_BASE_URL = String(process.env.OPENUNUM_BASE_URL || 'http://127.0.0.1:18880').replace(/\/+$/, '');

async function apiRequest(method, pathname, body = undefined) {
  const url = `${API_BASE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const init = { method: String(method || 'GET').toUpperCase(), headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const raw = await res.text();
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { ok: false, error: 'invalid_json_response', raw };
  }
  if (!res.ok) {
    const msg = parsed?.message || parsed?.error || `${res.status} ${res.statusText}`;
    throw new Error(`api_error ${init.method} ${pathname}: ${msg}`);
  }
  return parsed;
}

function summarizeProviderHealth(out = {}) {
  const providers = Array.isArray(out.providers) ? out.providers : [];
  const availability = Array.isArray(out.providerAvailability) ? out.providerAvailability : [];
  const degraded = providers.filter((p) => p.status !== 'healthy');
  const blocked = availability.filter((p) => p.blocked);
  return {
    totalProviders: providers.length,
    healthyProviders: providers.length - degraded.length,
    degradedProviders: degraded.length,
    blockedProviders: blocked.length,
    degraded: degraded.map((p) => ({ provider: p.provider, status: p.status, reason: p.degraded_reason || null })),
    blocked: blocked.map((p) => ({ provider: p.provider, lastFailureKind: p.lastFailureKind || null }))
  };
}

function summarizeMissionsList(out = {}) {
  const missions = Array.isArray(out.missions) ? out.missions : [];
  const statuses = missions.reduce((acc, row) => {
    const status = String(row?.status || 'unknown');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  return {
    total: missions.length,
    statuses
  };
}

async function main() {
  if (cmd === 'health') {
    console.log(JSON.stringify({ ok: true, service: 'openunum' }));
    return;
  }

  if (cmd === 'serve') {
    await import('./server.mjs');
    return;
  }

  if (cmd === 'chat') {
    const { agent } = getAgentContext();
    const message = getArg('--message', 'hello');
    const sessionId = getArg('--session', 'cli');
    const out = await agent.chat({ message, sessionId });
    console.log(out.reply);
    return;
  }

  if (cmd === 'context' && args[1] === 'status') {
    const { agent } = getAgentContext();
    const sessionId = getArg('--session', 'cli');
    const out = agent.getContextStatus(sessionId);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'context' && args[1] === 'compact') {
    const { agent } = getAgentContext();
    const sessionId = getArg('--session', 'cli');
    const dryRun = args.includes('--dry-run');
    const out = agent.compactSessionContext({ sessionId, dryRun });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'context' && args[1] === 'artifacts') {
    const { agent } = getAgentContext();
    const sessionId = getArg('--session', 'cli');
    const limit = Number(getArg('--limit', '40'));
    const out = agent.listContextArtifacts(sessionId, limit);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'model' && args[1] === 'switch') {
    const { agent } = getAgentContext();
    const provider = normalizeProviderId(getArg('--provider', config.model.provider));
    const model = getArg('--model', config.model.model);
    const out = agent.switchModel(provider, model);
    saveConfig(config);
    console.log(JSON.stringify(out));
    return;
  }

  if (cmd === 'status') {
    const { agent } = getAgentContext();
    const current = agent.getCurrentModel();
    console.log(JSON.stringify({
      ok: true,
      runtime: {
        autonomyMode: config.runtime?.autonomyMode || 'autonomy-first',
        workspaceRoot: config.runtime?.workspaceRoot || process.cwd()
      },
      model: current,
      providerOrder: PROVIDER_ORDER
    }, null, 2));
    return;
  }

  if (cmd === 'runtime' && args[1] === 'status') {
    const out = await apiRequest('GET', '/api/runtime/overview');
    console.log(JSON.stringify({
      ok: true,
      runtime: {
        autonomyMode: out.autonomyMode,
        workspaceRoot: out.workspaceRoot
      },
      selectedModel: out.selectedModel || null,
      fallbackModel: out.fallbackModel || null,
      providers: out.providers || []
    }, null, 2));
    return;
  }

  if (cmd === 'providers' && args[1] === 'list') {
    const { agent } = getAgentContext();
    const selectedProvider = normalizeProviderId(config.model?.provider);
    const rows = PROVIDER_ORDER.map((provider) => {
      const configured = String(config.model?.providerModels?.[provider] || '').trim();
      return {
        provider,
        selected: provider === selectedProvider,
        model: configured || null
      };
    });
    console.log(JSON.stringify({ ok: true, providers: rows }, null, 2));
    return;
  }

  if (cmd === 'providers' && args[1] === 'catalog') {
    const out = await apiRequest('GET', '/api/model-catalog');
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'providers' && args[1] === 'health') {
    const out = await apiRequest('GET', '/api/runtime/overview');
    console.log(JSON.stringify({
      ok: true,
      providers: out.providers || [],
      availability: out.providerAvailability || [],
      summary: summarizeProviderHealth(out)
    }, null, 2));
    return;
  }

  if (cmd === 'auth' && args[1] === 'status') {
    const modelCfg = config.model || {};
    const channels = config.channels || {};
    console.log(JSON.stringify({
      ok: true,
      providerAuth: {
        openrouter: Boolean(modelCfg.openrouterApiKey),
        nvidia: Boolean(modelCfg.nvidiaApiKey),
        xiaomimimo: Boolean(modelCfg.xiaomimimoApiKey),
        openai: Boolean(modelCfg.openaiApiKey)
      },
      channelAuth: {
        telegram: Boolean(channels.telegram?.botToken)
      }
    }, null, 2));
    return;
  }

  if (cmd === 'auth' && args[1] === 'catalog') {
    const out = await apiRequest('GET', '/api/auth/catalog');
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'missions' && args[1] === 'list') {
    const out = await apiRequest('GET', '/api/missions');
    console.log(JSON.stringify({
      ...out,
      summary: summarizeMissionsList(out)
    }, null, 2));
    return;
  }

  if (cmd === 'missions' && args[1] === 'status') {
    const id = String(getArg('--id', '')).trim();
    if (!id) throw new Error('missions status requires --id <missionId>');
    const out = await apiRequest('GET', `/api/missions/status?id=${encodeURIComponent(id)}`);
    if (args.includes('--with-timeline')) {
      const timeline = await apiRequest('GET', `/api/missions/timeline?id=${encodeURIComponent(id)}`);
      console.log(JSON.stringify({ ...out, timeline }, null, 2));
      return;
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'missions' && args[1] === 'timeline') {
    const id = String(getArg('--id', '')).trim();
    if (!id) throw new Error('missions timeline requires --id <missionId>');
    const out = await apiRequest('GET', `/api/missions/timeline?id=${encodeURIComponent(id)}`);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'missions' && args[1] === 'start') {
    const goal = String(getArg('--goal', '')).trim();
    if (!goal) throw new Error('missions start requires --goal <text>');
    const maxSteps = getArgNumber('--max-steps', null);
    const intervalMs = getArgNumber('--interval-ms', null);
    const payload = {
      goal,
      ...(Number.isFinite(maxSteps) ? { maxSteps } : {}),
      ...(Number.isFinite(intervalMs) ? { intervalMs } : {})
    };
    const out = await apiRequest('POST', '/api/missions/start', payload);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'missions' && args[1] === 'stop') {
    const id = String(getArg('--id', '')).trim();
    if (!id) throw new Error('missions stop requires --id <missionId>');
    const out = await apiRequest('POST', '/api/missions/stop', { id });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'sessions' && args[1] === 'list') {
    const limit = getArgNumber('--limit', 120);
    const out = await apiRequest('GET', `/api/sessions?limit=${encodeURIComponent(String(limit))}`);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'sessions' && args[1] === 'delete') {
    const id = String(getArg('--id', '')).trim();
    if (!id) throw new Error('sessions delete requires --id <sessionId>');
    const out = await apiRequest('DELETE', `/api/sessions/${encodeURIComponent(id)}`);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'browser' && args[1] === 'status') {
    const browser = new CDPBrowser(config.browser?.cdpUrl);
    const out = await browser.status();
    console.log(JSON.stringify(out));
    return;
  }

  if (cmd === 'telegram' && args[1] === 'poll-once') {
    const { agent } = getAgentContext();
    if (!config.channels.telegram?.botToken) throw new Error('Missing Telegram bot token');
    const tg = new TelegramChannel(config.channels.telegram, async (text, sessionId) => {
      const out = await agent.chat({ message: text, sessionId });
      return out.reply;
    });
    await tg.pollOnce();
    console.log('ok');
    return;
  }

  if (cmd === 'telegram' && args[1] === 'run') {
    const { agent } = getAgentContext();
    if (!config.channels.telegram?.botToken) throw new Error('Missing Telegram bot token');
    const tg = new TelegramChannel(config.channels.telegram, async (text, sessionId) => {
      const out = await agent.chat({ message: text, sessionId });
      return out.reply;
    });
    // Long-poll loop for production use.
    while (true) {
      try {
        await tg.pollOnce();
      } catch (error) {
        console.error(`telegram_poll_error: ${error.message || error}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  if (cmd === 'ollama' && args[1] === 'use') {
    const { agent } = getAgentContext();
    const model = getArg('--model', 'minimax-m2.7:cloud');
    const out = agent.switchModel('ollama-cloud', `ollama-cloud/${model}`);
    saveConfig(config);
    console.log(JSON.stringify(out));
    return;
  }

  if (cmd === 'command') {
    const { agent, memory, registry } = getAgentContext();
    const commandText = args.slice(1).join(' ');
    if (!commandText) {
      console.error('Usage: openunum command <slash-command>\nExample: openunum command /help');
      process.exit(1);
    }
    const message = commandText.startsWith('/') ? commandText : `/${commandText}`;
    const result = await registry.route(message, {
      sessionId: 'cli',
      agent,
      memoryStore: memory,
      config
    });
    if (result?.reply) {
      console.log(result.reply);
    } else if (result?.error) {
      console.error(result.error);
      process.exit(1);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  console.log(`openunum commands:\n  health\n  status\n  runtime status\n  serve\n  chat --message <text> [--session <id>]\n  context status --session <id>\n  context compact --session <id> [--dry-run]\n  context artifacts --session <id> [--limit <n>]\n  model switch --provider <p> --model <m>\n  providers list\n  providers catalog\n  providers health\n  auth status\n  auth catalog\n  missions list\n  missions status --id <missionId>\n  missions start --goal <text> [--max-steps <n>] [--interval-ms <n>]\n  missions stop --id <missionId>\n  sessions list [--limit <n>]\n  sessions delete --id <sessionId>\n  ollama use --model <id>  # compatibility alias for ollama-cloud\n  browser status\n  telegram poll-once\n  telegram run\n  command <slash-command>\n\n  remote API base: ${API_BASE_URL}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
