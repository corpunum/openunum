export class WhatsAppTwilioChannel {
  constructor(config, onMessage) {
    this.config = config;
    this.onMessage = onMessage;
  }

  async send(to, message) {
    const base = `https://api.twilio.com/2010-04-01/Accounts/${this.config.twilioAccountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: to,
      From: this.config.twilioFrom,
      Body: message
    });

    const token = Buffer.from(`${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`).toString('base64');
    const res = await fetch(base, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio send failed: ${res.status} ${text}`);
    }
    return res.json();
  }
}
