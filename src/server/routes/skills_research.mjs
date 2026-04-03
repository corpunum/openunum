export async function handleSkillsResearchRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/skills') {
    const out = await ctx.agent.runTool('skill_list', {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/install') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('skill_install', body || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/review') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('skill_review', { name: body.name });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/approve') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('skill_approve', { name: body.name });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/execute') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('skill_execute', { name: body.name, args: body.args || {} });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/uninstall') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('skill_uninstall', { name: body.name });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/email/status') {
    const out = await ctx.agent.runTool('email_status', {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/email/send') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('email_send', body || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/email/list') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('email_list', body || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/email/read') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('email_read', body || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/gworkspace/call') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('gworkspace_call', body || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/research/run') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('research_run_daily', { simulate: Boolean(body?.simulate) });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/research/recent') {
    const out = await ctx.agent.runTool('research_list_recent', {
      limit: Number(url.searchParams.get('limit') || 10)
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/research/queue') {
    const out = await ctx.agent.runTool('research_review_queue', {
      limit: Number(url.searchParams.get('limit') || 50)
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/research/approve') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool('research_approve', {
      url: String(body?.url || ''),
      note: String(body?.note || '')
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  return false;
}

