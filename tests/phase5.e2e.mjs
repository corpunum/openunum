import { loadConfig } from '../src/config.mjs';
import { TelegramChannel } from '../src/channels/telegram.mjs';
import { WhatsAppTwilioChannel } from '../src/channels/whatsapp-twilio.mjs';

const cfg = loadConfig();
new TelegramChannel(cfg.channels.telegram, async () => 'ok');
new WhatsAppTwilioChannel(cfg.channels.whatsapp, async () => 'ok');

if (!cfg.channels.telegram.botToken && !cfg.channels.whatsapp.twilioAccountSid) {
  console.log('phase5 soft-skip: no Telegram/Twilio credentials configured');
  process.exit(0);
}

console.log('phase5 adapter init ok');
