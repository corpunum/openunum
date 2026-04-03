import { TelegramChannel } from '../../channels/telegram.mjs';

export function createTelegramRuntimeService({ config, agent, logError }) {
  let running = false;
  let stopRequested = false;
  let loopPromise = null;

  async function runTelegramLoop() {
    if (!config.channels.telegram?.botToken) {
      throw new Error('Missing Telegram bot token');
    }
    if (running) return;
    stopRequested = false;
    running = true;
    const tg = new TelegramChannel(config.channels.telegram, async (text, sessionId) => {
      const out = await agent.chat({ message: text, sessionId });
      return out.reply;
    });
    loopPromise = (async () => {
      while (!stopRequested) {
        try {
          await tg.pollOnce();
        } catch (error) {
          logError('telegram_poll_error', { error: String(error.message || error) });
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      running = false;
    })();
  }

  async function stopTelegramLoop() {
    stopRequested = true;
    if (loopPromise) {
      await Promise.race([loopPromise, new Promise((r) => setTimeout(r, 3000))]);
    }
    running = false;
  }

  return {
    runTelegramLoop,
    stopTelegramLoop,
    isRunning: () => running,
    isStopRequested: () => stopRequested
  };
}

