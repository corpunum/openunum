#!/usr/bin/env node
import { loadConfig, saveConfig } from './config.mjs';
import { MemoryStore } from './memory/store.mjs';
import { OpenUnumAgent } from './core/agent.mjs';
import { CDPBrowser } from './browser/cdp.mjs';
import { TelegramChannel } from './channels/telegram.mjs';
import { WhatsAppTwilioChannel } from './channels/whatsapp-twilio.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const config = loadConfig();
const memory = new MemoryStore();
const agent = new OpenUnumAgent({ config, memoryStore: memory });

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

  if (cmd === 'model' && args[1] === 'switch') {
    const provider = getArg('--provider', config.model.provider);
    const model = getArg('--model', config.model.model);
    const out = agent.switchModel(provider, model);
    saveConfig(config);
    console.log(JSON.stringify(out));
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

  if (cmd === 'whatsapp' && args[1] === 'send') {
    const to = getArg('--to');
    const message = getArg('--message', 'hello');
    if (!to) throw new Error('Missing --to');
    const wa = new WhatsAppTwilioChannel(config.channels.whatsapp, async () => '');
    const out = await wa.send(to, message);
    console.log(JSON.stringify(out));
    return;
  }

  console.log(`openunum commands:\n  health\n  serve\n  chat --message <text> [--session <id>]\n  model switch --provider <p> --model <m>\n  browser status\n  telegram poll-once\n  whatsapp send --to <whatsapp:+...> --message <text>`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
