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
const memory = new MemoryStore();
const agent = new OpenUnumAgent({ config, memoryStore: memory });
loadBuiltinCommands();
const registry = getRegistry();

function getArg(name, fallback = '') {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args[i + 1] ?? fallback;
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
    const message = getArg('--message', 'hello');
    const sessionId = getArg('--session', 'cli');
    const out = await agent.chat({ message, sessionId });
    console.log(out.reply);
    return;
  }

  if (cmd === 'context' && args[1] === 'status') {
    const sessionId = getArg('--session', 'cli');
    const out = agent.getContextStatus(sessionId);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'context' && args[1] === 'compact') {
    const sessionId = getArg('--session', 'cli');
    const dryRun = args.includes('--dry-run');
    const out = agent.compactSessionContext({ sessionId, dryRun });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'context' && args[1] === 'artifacts') {
    const sessionId = getArg('--session', 'cli');
    const limit = Number(getArg('--limit', '40'));
    const out = agent.listContextArtifacts(sessionId, limit);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'model' && args[1] === 'switch') {
    const provider = normalizeProviderId(getArg('--provider', config.model.provider));
    const model = getArg('--model', config.model.model);
    const out = agent.switchModel(provider, model);
    saveConfig(config);
    console.log(JSON.stringify(out));
    return;
  }

  if (cmd === 'status') {
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

  if (cmd === 'providers' && args[1] === 'list') {
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

  if (cmd === 'browser' && args[1] === 'status') {
    const browser = new CDPBrowser(config.browser?.cdpUrl);
    const out = await browser.status();
    console.log(JSON.stringify(out));
    return;
  }

  if (cmd === 'telegram' && args[1] === 'poll-once') {
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
    const model = getArg('--model', 'minimax-m2.7:cloud');
    const out = agent.switchModel('ollama-cloud', `ollama-cloud/${model}`);
    saveConfig(config);
    console.log(JSON.stringify(out));
    return;
  }

  if (cmd === 'command') {
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

  console.log(`openunum commands:\n  health\n  status\n  serve\n  chat --message <text> [--session <id>]\n  context status --session <id>\n  context compact --session <id> [--dry-run]\n  context artifacts --session <id> [--limit <n>]\n  model switch --provider <p> --model <m>\n  providers list\n  auth status\n  ollama use --model <id>  # compatibility alias for ollama-cloud\n  browser status\n  telegram poll-once\n  telegram run\n  command <slash-command>`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
