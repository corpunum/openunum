export async function handleMissionsRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/missions') {
    ctx.sendJson(res, 200, { missions: ctx.missions.list() });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/missions/status') {
    const id = url.searchParams.get('id') || '';
    const mission = ctx.missions.get(id);
    if (!mission) {
      ctx.sendJson(res, 404, { error: 'mission_not_found' });
      return true;
    }
    ctx.sendJson(res, 200, { mission });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/missions/timeline') {
    const id = String(url.searchParams.get('id') || '').trim();
    const mission = ctx.missions.get(id);
    if (!mission) {
      ctx.sendJson(res, 404, { error: 'mission_not_found' });
      return true;
    }
    ctx.sendJson(res, 200, ctx.buildMissionTimeline(mission));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/missions/start') {
    const body = await ctx.parseBody(req);
    const out = ctx.missions.start({
      goal: body.goal,
      maxSteps: body.maxSteps,
      intervalMs: body.intervalMs ?? ctx.config.runtime.missionDefaultIntervalMs,
      maxRetries: body.maxRetries ?? ctx.config.runtime.missionDefaultMaxRetries,
      continueUntilDone: body.continueUntilDone ?? ctx.config.runtime.missionDefaultContinueUntilDone,
      hardStepCap: body.hardStepCap ?? ctx.config.runtime.missionDefaultHardStepCap
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/missions/stop') {
    const body = await ctx.parseBody(req);
    ctx.sendJson(res, 200, ctx.missions.stop(body.id));
    return true;
  }

  return false;
}

