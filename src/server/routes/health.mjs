export async function handleHealthRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
    const health = await ctx.runHealthCheck();
    ctx.sendJson(res, 200, {
      ok: true,
      service: 'openunum',
      health
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/self-heal') {
    const dryRun = url.searchParams.get('dryRun') !== 'false';
    const result = await ctx.runSelfHeal(dryRun);
    ctx.sendJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/self-heal') {
    const body = await ctx.parseBody(req);
    const dryRun = body.dryRun !== false;
    const result = await ctx.runSelfHeal(dryRun);
    ctx.sendJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/self-heal/fix') {
    const result = await ctx.runSelfHeal(false);
    ctx.sendJson(res, 200, result);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/health/check') {
    const health = await ctx.runHealthCheck();
    ctx.sendJson(res, health.ok ? 200 : 503, health);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/selfheal/run') {
    const body = await ctx.parseBody(req);
    const dryRun = Boolean(body?.dryRun);
    const result = await ctx.runSelfHeal(dryRun);
    if (!dryRun && result.ok) {
      ctx.logInfo('selfheal_executed', { actions: result.actions.length, results: result.results.length });
    }
    ctx.sendJson(res, result.ok ? 200 : 500, result);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/selfheal/status') {
    const status = typeof ctx.selfHealStatus === 'function'
      ? ctx.selfHealStatus()
      : {
        ok: true,
        uptime: process.uptime(),
        pendingChats: ctx.pendingChats.size,
        telegramRunning: ctx.telegramLoopRunning(),
        config: {
          autonomyMode: ctx.config.runtime.autonomyMode,
          shellEnabled: ctx.config.runtime.shellEnabled,
          maxToolIterations: ctx.config.runtime.maxToolIterations
        },
        model: ctx.agent.getCurrentModel(),
        browser: { cdpUrl: ctx.config.browser?.cdpUrl },
        timestamp: new Date().toISOString()
      };
    ctx.sendJson(res, 200, status);
    return true;
  }

  return false;
}
