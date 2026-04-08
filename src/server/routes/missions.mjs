export async function handleMissionsRoute({ req, res, url, ctx }) {
  const getRuntimeState = ({ sessionId = '', goal = '', phase = 'phase0', nextAction = '' } = {}) => {
    if (typeof ctx.buildRuntimeStateAttachment !== 'function') return null;
    return ctx.buildRuntimeStateAttachment({ sessionId, goal, phase, nextAction });
  };

  if (req.method === 'GET' && url.pathname === '/api/missions') {
    const list = ctx.missions.list();
    const schedules = ctx.missions.listSchedules();
    // Wrap schedules in a similar format or just provide them alongside
    ctx.sendJson(res, 200, { 
      missions: list,
      schedules: schedules.map(s => ({
        ...s,
        isSchedule: true,
        sessionId: `schedule-${s.id}`
      }))
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/missions/status') {
    const id = url.searchParams.get('id') || '';
    const mission = ctx.missions.get(id);
    if (!mission) {
      ctx.sendJson(res, 404, { error: 'mission_not_found' });
      return true;
    }
    ctx.sendJson(res, 200, {
      mission,
      runtimeState: getRuntimeState({
        sessionId: mission.sessionId,
        goal: mission.goal,
        nextAction: 'Monitor mission progress and evidence'
      })
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/missions/timeline') {
    const id = String(url.searchParams.get('id') || '').trim();
    const mission = ctx.missions.get(id);
    if (!mission) {
      ctx.sendJson(res, 404, { error: 'mission_not_found' });
      return true;
    }
    ctx.sendJson(res, 200, {
      ...ctx.buildMissionTimeline(mission),
      runtimeState: getRuntimeState({
        sessionId: mission.sessionId,
        goal: mission.goal,
        nextAction: 'Inspect timeline and continue mission'
      })
    });
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
    ctx.sendJson(res, 200, {
      ...out,
      runtimeState: getRuntimeState({
        sessionId: out.sessionId,
        goal: body.goal,
        nextAction: 'Mission started; track until proof-complete'
      })
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/missions/stop') {
    const body = await ctx.parseBody(req);
    ctx.sendJson(res, 200, ctx.missions.stop(body.id));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/missions/schedules') {
    const limit = Number(url.searchParams.get('limit') || 120);
    ctx.sendJson(res, 200, {
      schedules: ctx.missions.listSchedules(limit)
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/missions/schedule') {
    const body = await ctx.parseBody(req);
    const out = ctx.missions.startSchedule({
      goal: body.goal,
      runAt: body.runAt,
      delayMs: body.delayMs,
      intervalMs: body.intervalMs,
      enabled: body.enabled,
      options: {
        maxSteps: body.maxSteps,
        maxRetries: body.maxRetries,
        continueUntilDone: body.continueUntilDone,
        hardStepCap: body.hardStepCap,
        intervalMs: body.missionIntervalMs
      }
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/missions/schedule/update') {
    const body = await ctx.parseBody(req);
    const id = String(body?.id || '').trim();
    if (!id) {
      ctx.sendJson(res, 400, { error: 'schedule_id_required' });
      return true;
    }
    const updated = ctx.missions.updateSchedule(id, {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      status: body.status ? String(body.status) : undefined,
      runAt: body.runAt ? String(body.runAt) : undefined,
      nextRunAt: body.nextRunAt ? String(body.nextRunAt) : undefined,
      intervalMs: Number.isFinite(body.intervalMs) ? Number(body.intervalMs) : undefined
    });
    if (!updated) {
      ctx.sendJson(res, 404, { error: 'schedule_not_found' });
      return true;
    }
    ctx.sendJson(res, 200, { ok: true, schedule: updated });
    return true;
  }

  return false;
}
