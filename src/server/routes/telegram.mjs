function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function handleTelegramRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/telegram/config') {
    ctx.reloadConfigSecrets();
    const tg = ctx.config.channels.telegram || { botToken: '', enabled: false };
    ctx.sendJson(res, 200, { enabled: Boolean(tg.enabled), hasToken: Boolean(tg.botToken) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/telegram/config') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const tg = ctx.config.channels.telegram || {};
    const secretUpdates = {};
    if (typeof body.botToken === 'string') secretUpdates.telegramBotToken = body.botToken.trim();
    if (typeof body.enabled === 'boolean') tg.enabled = body.enabled;
    ctx.config.channels.telegram = tg;
    ctx.persistSecretUpdates(secretUpdates);
    ctx.saveConfig(ctx.config);
    ctx.sendJson(res, 200, {
      ok: true,
      enabled: Boolean(ctx.config.channels?.telegram?.enabled),
      hasToken: Boolean(ctx.config.channels?.telegram?.botToken)
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/telegram/status') {
    ctx.sendJson(res, 200, { running: ctx.telegramLoopRunning(), stopRequested: ctx.telegramLoopStopRequested() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/telegram/start') {
    await ctx.runTelegramLoop();
    ctx.sendJson(res, 200, { ok: true, running: ctx.telegramLoopRunning() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/telegram/stop') {
    await ctx.stopTelegramLoop();
    ctx.sendJson(res, 200, { ok: true, running: ctx.telegramLoopRunning() });
    return true;
  }

  return false;
}
