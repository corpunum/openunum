import {
  getWorkerOrchestrator,
  getSelfEditPipeline,
  getModelScoutWorkflow,
  getTaskOrchestrator,
  getGoalTaskPlanner
} from '../../core/autonomy-registry.mjs';

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

  if (req.method === 'GET' && url.pathname === '/api/autonomy/workers') {
    const orchestrator = getWorkerOrchestrator(ctx);
    const limit = Number(url.searchParams.get('limit') || 80);
    ctx.sendJson(res, 200, orchestrator.listWorkers(limit));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/workers/status') {
    const orchestrator = getWorkerOrchestrator(ctx);
    const id = String(url.searchParams.get('id') || '').trim();
    if (!id) {
      ctx.sendJson(res, 400, { ok: false, error: 'id is required' });
      return true;
    }
    const out = orchestrator.getWorker(id);
    ctx.sendJson(res, out.ok ? 200 : 404, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/workers/start') {
    const orchestrator = getWorkerOrchestrator(ctx);
    const body = await ctx.parseBody(req);
    const out = orchestrator.startWorker(body || {});
    ctx.sendJson(res, out.ok ? 200 : 400, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/workers/stop') {
    const orchestrator = getWorkerOrchestrator(ctx);
    const body = await ctx.parseBody(req);
    const out = orchestrator.stopWorker(body?.id);
    ctx.sendJson(res, out.ok ? 200 : 404, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/workers/tick') {
    const orchestrator = getWorkerOrchestrator(ctx);
    const body = await ctx.parseBody(req);
    const out = await orchestrator.tickWorker(body?.id);
    ctx.sendJson(res, out.ok ? 200 : 404, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/self-edit') {
    const pipeline = getSelfEditPipeline(ctx);
    const limit = Number(url.searchParams.get('limit') || 40);
    ctx.sendJson(res, 200, pipeline.listRuns(limit));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/self-edit/status') {
    const pipeline = getSelfEditPipeline(ctx);
    const id = String(url.searchParams.get('id') || '').trim();
    if (!id) {
      ctx.sendJson(res, 400, { ok: false, error: 'id is required' });
      return true;
    }
    const out = pipeline.getRun(id);
    ctx.sendJson(res, out.ok ? 200 : 404, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/self-edit/run') {
    const pipeline = getSelfEditPipeline(ctx);
    const body = await ctx.parseBody(req);
    const out = await pipeline.run(body || {});
    ctx.sendJson(res, out.ok ? 200 : 400, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/model-scout') {
    const workflow = getModelScoutWorkflow(ctx);
    const limit = Number(url.searchParams.get('limit') || 20);
    ctx.sendJson(res, 200, workflow.listRuns(limit));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/model-scout/status') {
    const workflow = getModelScoutWorkflow(ctx);
    const id = String(url.searchParams.get('id') || '').trim();
    if (!id) {
      ctx.sendJson(res, 400, { ok: false, error: 'id is required' });
      return true;
    }
    const out = workflow.getRun(id);
    ctx.sendJson(res, out.ok ? 200 : 404, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/model-scout/run') {
    const workflow = getModelScoutWorkflow(ctx);
    const body = await ctx.parseBody(req);
    const out = await workflow.run(body || {});
    ctx.sendJson(res, out.ok ? 200 : 400, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/tasks') {
    const orchestrator = getTaskOrchestrator(ctx);
    const limit = Number(url.searchParams.get('limit') || 20);
    ctx.sendJson(res, 200, orchestrator.listTasks(limit));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/autonomy/tasks/status') {
    const orchestrator = getTaskOrchestrator(ctx);
    const id = String(url.searchParams.get('id') || '').trim();
    if (!id) {
      ctx.sendJson(res, 400, { ok: false, error: 'id is required' });
      return true;
    }
    const out = orchestrator.getTask(id);
    ctx.sendJson(res, out.ok ? 200 : 404, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/tasks/plan') {
    const planner = getGoalTaskPlanner(ctx);
    const body = await ctx.parseBody(req);
    const out = planner.plan(body || {});
    ctx.sendJson(res, out.ok ? 200 : 400, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/autonomy/tasks/run') {
    const orchestrator = getTaskOrchestrator(ctx);
    const body = await ctx.parseBody(req);
    const out = await orchestrator.runTask(body || {});
    ctx.sendJson(res, out.ok ? 200 : 400, out);
    return true;
  }

  return false;
}
