function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value, fallback = null) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

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
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
      return true;
    }
    const goal = String(body.goal || '').trim();
    if (!goal) {
      ctx.sendJson(res, 400, { ok: false, error: 'goal_required' });
      return true;
    }
    const out = ctx.missions.start({
      goal,
      maxSteps: toFiniteNumber(body.maxSteps, undefined),
      intervalMs: toFiniteNumber(body.intervalMs, ctx.config.runtime.missionDefaultIntervalMs),
      maxRetries: toFiniteNumber(body.maxRetries, ctx.config.runtime.missionDefaultMaxRetries),
      continueUntilDone: body.continueUntilDone ?? ctx.config.runtime.missionDefaultContinueUntilDone,
      hardStepCap: toFiniteNumber(body.hardStepCap, ctx.config.runtime.missionDefaultHardStepCap)
    });
    ctx.sendJson(res, 200, {
      ...out,
      runtimeState: getRuntimeState({
        sessionId: out.sessionId,
        goal,
        nextAction: 'Mission started; track until proof-complete'
      })
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/missions/stop') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
      return true;
    }
    const id = String(body.id || '').trim();
    if (!id) {
      ctx.sendJson(res, 400, { ok: false, error: 'mission_id_required' });
      return true;
    }
    ctx.sendJson(res, 200, ctx.missions.stop(id));
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
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
      return true;
    }
    const goal = String(body.goal || '').trim();
    if (!goal) {
      ctx.sendJson(res, 400, { ok: false, error: 'goal_required' });
      return true;
    }
    const out = ctx.missions.startSchedule({
      goal,
      runAt: body.runAt,
      delayMs: toFiniteNumber(body.delayMs, undefined),
      intervalMs: toFiniteNumber(body.intervalMs, undefined),
      enabled: body.enabled,
      options: {
        maxSteps: toFiniteNumber(body.maxSteps, undefined),
        maxRetries: toFiniteNumber(body.maxRetries, undefined),
        continueUntilDone: body.continueUntilDone,
        hardStepCap: toFiniteNumber(body.hardStepCap, undefined),
        intervalMs: toFiniteNumber(body.missionIntervalMs, undefined)
      }
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/missions/schedule/update') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
      return true;
    }
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
