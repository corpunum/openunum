import { loadConfig } from '../src/config.mjs';
import { TelegramChannel } from '../src/channels/telegram.mjs';

const cfg = loadConfig();
new TelegramChannel(cfg.channels.telegram, async () => 'ok');

if (!cfg.channels.telegram.botToken) {
  console.log('phase5 soft-skip: no Telegram bot token configured');
  process.exit(0);
}

console.log('phase5 telegram adapter init ok');
