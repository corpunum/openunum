import { TelegramChannel } from '../../channels/telegram.mjs';

export function createTelegramRuntimeService({ config, agent, logError }) {
  let running = false;
  let stopRequested = false;
  let loopPromise = null;
  let memoryStore = null;

  async function getMemoryStore() {
    if (!memoryStore) {
      const { MemoryStore } = await import('../../memory/store.mjs');
      memoryStore = new MemoryStore();
    }
    return memoryStore;
  }

  async function runTelegramLoop() {
    if (!config.channels.telegram?.botToken) {
      throw new Error('Missing Telegram bot token');
    }
    if (running) return;
    stopRequested = false;
    running = true;

    const store = await getMemoryStore();
    const persistedOffset = store.getChannelState('telegram', 'offset', 0);
    const streamingConfig = config.channels.telegram?.streaming || {};

    const tg = new TelegramChannel(config.channels.telegram, async (text, sessionId, { attachments } = {}) => {
      const timeoutMs = Number(config?.runtime?.telegramReplyTimeoutMs || 300000);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('telegram_chat_timeout')), timeoutMs);
      });

      // Download any inbound media attachments
      let downloadedAttachments = [];
      if (attachments && attachments.length > 0) {
        downloadedAttachments = await Promise.all(
          attachments.map((att) => tg.downloadAttachment(att).catch(() => null))
        ).then((results) => results.filter(Boolean));
      }

      // Build the message for the agent — include media descriptions in the prompt
      let agentMessage = text;
      if (downloadedAttachments.length > 0) {
        const mediaDesc = downloadedAttachments.map((a) =>
          `[User sent ${a.type}: ${a.fileName || a.mimeType}]`
        ).join(' ');
        agentMessage = `${mediaDesc}\n${text}`;
      }

      const chatPromise = agent.chat({ message: agentMessage, sessionId });

      try {
        // Extract chatId for streaming
        const chatId = parseInt(sessionId.replace('telegram:', ''), 10);
        const isStreamingEnabled = streamingConfig.enabled !== false;

        if (isStreamingEnabled && !isNaN(chatId)) {
          // Streaming path: progressive edits via editMessageText
          const out = await tg.streamingReply(chatId, sessionId, Promise.race([chatPromise, timeoutPromise]), {
            editIntervalMs: Number(streamingConfig.editIntervalMs || 1500),
            placeholderText: streamingConfig.placeholderText || 'Thinking...'
          });
          return out;
        } else {
          // Non-streaming path: wait for full response, then deliver
          const out = await Promise.race([chatPromise, timeoutPromise]);
          await tg.deliverFullResponse(chatId, out);
          return out;
        }
      } catch (error) {
        logError('telegram_chat_failed', {
          sessionId,
          error: String(error?.message || error)
        });
        if (String(error?.message || error) === 'telegram_chat_timeout') {
          return { reply: 'I hit a response timeout while processing your message. Please retry with a shorter prompt.' };
        }
        return { reply: 'I hit a runtime error while processing your message. Please retry.' };
      }
    }, persistedOffset);

    try {
      await tg.clearWebhook({ dropPendingUpdates: false });
    } catch (error) {
      logError('telegram_webhook_reset_failed', { error: String(error?.message || error) });
    }

    loopPromise = (async () => {
      let conflictCount = 0;
      while (!stopRequested) {
        try {
          await tg.pollOnce();
          conflictCount = 0;
          const currentOffset = tg.getOffset();
          store.setChannelState('telegram', 'offset', currentOffset);
        } catch (error) {
          const errorText = String(error?.message || error);
          const isConflict = /\b409\b.*\bconflict\b/i.test(errorText);
          if (isConflict) {
            conflictCount += 1;
            logError('telegram_poll_conflict', {
              error: errorText,
              conflictCount
            });
            try {
              await tg.clearWebhook({ dropPendingUpdates: false });
            } catch (webhookError) {
              logError('telegram_webhook_reset_failed', { error: String(webhookError?.message || webhookError) });
            }
            const conflictDelay = Math.min(12000, 2000 + (conflictCount * 1000));
            await new Promise(r => setTimeout(r, conflictDelay));
            continue;
          }
          logError('telegram_poll_error', { error: errorText });
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      running = false;
    })();
  }

  async function stopTelegramLoop() {
    stopRequested = true;
    if (loopPromise) {
      await Promise.race([loopPromise, new Promise(r => setTimeout(r, 3000))]);
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
