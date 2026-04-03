export async function handleAutonomyRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/autonomy/mode') {
    ctx.sendJson(res, 200, {
      mode: ctx.config.runtime.autonomyMode || 'standard',
      runtime: ctx.config.runtime,
      routing: ctx.config.model.routing
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/mode') {
    const body = await ctx.parseBody(req);
    const mode = ctx.applyAutonomyMode(body.mode);
    ctx.saveConfig(ctx.config);
    ctx.agent.reloadTools();
    ctx.sendJson(res, 200, {
      ok: true,
      mode,
      runtime: ctx.config.runtime,
      routing: ctx.config.model.routing
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/master/status') {
    ctx.sendJson(res, 200, { ok: true, status: ctx.autonomyMaster.getStatus() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/master/start') {
    const started = ctx.autonomyMaster.start();
    ctx.sendJson(res, 200, { ok: true, started, status: ctx.autonomyMaster.getStatus() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/master/stop') {
    const stopped = ctx.autonomyMaster.stop();
    ctx.sendJson(res, 200, { ok: true, stopped, status: ctx.autonomyMaster.getStatus() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/master/cycle') {
    const out = await ctx.autonomyMaster.runCycle();
    ctx.sendJson(res, 200, { ok: true, result: out });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/master/self-improve') {
    const out = await ctx.autonomyMaster.selfImprove();
    ctx.sendJson(res, 200, { ok: true, result: out });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/master/learn-skills') {
    const out = await ctx.autonomyMaster.learnSkills();
    ctx.sendJson(res, 200, { ok: true, result: out });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/master/self-test') {
    const out = await ctx.autonomyMaster.fullSelfTest();
    ctx.sendJson(res, 200, { ok: true, result: out });
    return true;
  }

  return false;
}

