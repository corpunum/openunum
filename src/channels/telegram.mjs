export class TelegramChannel {
  constructor(config, onMessage) {
    this.config = config;
    this.onMessage = onMessage;
    this.offset = 0;
  }

  api(path) {
    return `https://api.telegram.org/bot${this.config.botToken}${path}`;
  }

  async send(chatId, text) {
    const res = await fetch(this.api('/sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    if (!res.ok) throw new Error(`Telegram send failed: ${res.status}`);
  }

  async pollOnce() {
    const res = await fetch(this.api(`/getUpdates?timeout=20&offset=${this.offset}`));
    if (!res.ok) throw new Error(`Telegram poll failed: ${res.status}`);
    const data = await res.json();
    const updates = data?.result || [];
    for (const u of updates) {
      this.offset = Math.max(this.offset, u.update_id + 1);
      const msg = u.message?.text;
      const chatId = u.message?.chat?.id;
      if (!msg || !chatId) continue;
      const reply = await this.onMessage(msg, `telegram:${chatId}`);
      await this.send(chatId, reply);
    }
  }
}
