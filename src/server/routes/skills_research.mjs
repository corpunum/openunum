function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function runApiTool(ctx, name, args = {}) {
  return ctx.agent.runTool(name, args, { summarizeResult: false, surface: 'api' });
}

export async function handleSkillsResearchRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/skills') {
    const out = await runApiTool(ctx, 'skill_list', {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/install') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const out = await runApiTool(ctx, 'skill_install', body || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/review') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const name = String(body.name || '').trim();
    if (!name) {
      ctx.sendJson(res, 400, { ok: false, error: 'skill_name_required' });
      return true;
    }
    const out = await runApiTool(ctx, 'skill_review', { name });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/approve') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const name = String(body.name || '').trim();
    if (!name) {
      ctx.sendJson(res, 400, { ok: false, error: 'skill_name_required' });
      return true;
    }
    const out = await runApiTool(ctx, 'skill_approve', { name });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/execute') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const name = String(body.name || '').trim();
    if (!name) {
      ctx.sendJson(res, 400, { ok: false, error: 'skill_name_required' });
      return true;
    }
    const out = await runApiTool(ctx, 'skill_execute', { name, args: body.args || {} });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/uninstall') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const name = String(body.name || '').trim();
    if (!name) {
      ctx.sendJson(res, 400, { ok: false, error: 'skill_name_required' });
      return true;
    }
    const out = await runApiTool(ctx, 'skill_uninstall', { name });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/email/status') {
    const out = await runApiTool(ctx, 'email_status', {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/email/send') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const out = await runApiTool(ctx, 'email_send', body || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/email/list') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const out = await runApiTool(ctx, 'email_list', body || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/email/read') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const out = await runApiTool(ctx, 'email_read', body || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/gworkspace/call') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const out = await runApiTool(ctx, 'gworkspace_call', body || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/research/run') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const out = await runApiTool(ctx, 'research_run_daily', { simulate: Boolean(body?.simulate) });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/research/recent') {
    const out = await runApiTool(ctx, 'research_list_recent', {
      limit: Number(url.searchParams.get('limit') || 10)
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/research/queue') {
    const out = await runApiTool(ctx, 'research_review_queue', {
      limit: Number(url.searchParams.get('limit') || 50)
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/research/approve') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const out = await runApiTool(ctx, 'research_approve', {
      url: String(body?.url || ''),
      note: String(body?.note || '')
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  return false;
}
