import {
  validateMissionScheduleRequest,
  validateMissionScheduleUpdateRequest,
  validateMissionStartRequest,
  validateMissionStopRequest
} from '../contracts/request-contracts.mjs';

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
    const validation = validateMissionStartRequest(body);
    if (!validation.ok) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: validation.errors });
      return true;
    }
    const goal = String(validation.value.goal || '').trim();
    const out = ctx.missions.start({
      goal,
      maxSteps: toFiniteNumber(validation.value.maxSteps, undefined),
      intervalMs: toFiniteNumber(validation.value.intervalMs, ctx.config.runtime.missionDefaultIntervalMs),
      maxRetries: toFiniteNumber(validation.value.maxRetries, ctx.config.runtime.missionDefaultMaxRetries),
      continueUntilDone: validation.value.continueUntilDone ?? ctx.config.runtime.missionDefaultContinueUntilDone,
      hardStepCap: toFiniteNumber(validation.value.hardStepCap, ctx.config.runtime.missionDefaultHardStepCap)
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
    const validation = validateMissionStopRequest(body);
    if (!validation.ok) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: validation.errors });
      return true;
    }
    const id = String(validation.value.id || '').trim();
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
    const validation = validateMissionScheduleRequest(body);
    if (!validation.ok) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: validation.errors });
      return true;
    }
    const goal = String(validation.value.goal || '').trim();
    const out = ctx.missions.startSchedule({
      goal,
      runAt: validation.value.runAt,
      delayMs: toFiniteNumber(validation.value.delayMs, undefined),
      intervalMs: toFiniteNumber(validation.value.intervalMs, undefined),
      enabled: validation.value.enabled,
      options: {
        maxSteps: toFiniteNumber(validation.value.maxSteps, undefined),
        maxRetries: toFiniteNumber(validation.value.maxRetries, undefined),
        continueUntilDone: validation.value.continueUntilDone,
        hardStepCap: toFiniteNumber(validation.value.hardStepCap, undefined),
        intervalMs: toFiniteNumber(validation.value.missionIntervalMs, undefined)
      }
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/missions/schedule/update') {
    const body = await ctx.parseBody(req);
    const validation = validateMissionScheduleUpdateRequest(body);
    if (!validation.ok) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: validation.errors });
      return true;
    }
    const id = String(validation.value.id || '').trim();
    const updated = ctx.missions.updateSchedule(id, {
      enabled: typeof validation.value.enabled === 'boolean' ? validation.value.enabled : undefined,
      status: validation.value.status ? String(validation.value.status) : undefined,
      runAt: validation.value.runAt ? String(validation.value.runAt) : undefined,
      nextRunAt: validation.value.nextRunAt ? String(validation.value.nextRunAt) : undefined,
      intervalMs: Number.isFinite(validation.value.intervalMs) ? Number(validation.value.intervalMs) : undefined
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
