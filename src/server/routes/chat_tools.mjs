export async function handleChatToolsRoute({ req, res, url, ctx }) {
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await ctx.parseBody(req);
    const sessionId = String(body.sessionId || '').trim();
    const message = String(body.message || '').trim();
    if (!sessionId) {
      ctx.sendJson(res, 400, { error: 'sessionId is required' });
      return true;
    }
    if (!message) {
      ctx.sendJson(res, 400, { error: 'message is required' });
      return true;
    }

    const existing = ctx.pendingChats.get(sessionId);
    if (existing) {
      ctx.sendJson(res, 202, {
        ok: true,
        pending: true,
        sessionId,
        startedAt: existing.startedAt,
        note: 'chat_already_running_for_session'
      });
      return true;
    }

    const entry = ctx.getOrStartChat(sessionId, message);
    try {
      const out = await ctx.withTimeout(entry.promise, 20 * 1000, 'chat_timeout');
      ctx.sendJson(res, 200, { ...out, replyHtml: ctx.renderReplyHtml(out.reply) });
      return true;
    } catch (error) {
      if (String(error.message || error) === 'chat_timeout') {
        ctx.sendJson(res, 202, {
          ok: true,
          pending: true,
          sessionId,
          startedAt: entry.startedAt,
          note: 'chat_still_running'
        });
        return true;
      }
      throw error;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/chat/pending') {
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    if (!sessionId) {
      ctx.sendJson(res, 400, { error: 'sessionId is required' });
      return true;
    }
    const existing = ctx.pendingChats.get(sessionId);
    if (!existing) {
      ctx.sendJson(res, 200, { ok: true, pending: false, sessionId });
      return true;
    }
    ctx.sendJson(res, 200, {
      ok: true,
      pending: true,
      sessionId,
      startedAt: existing.startedAt
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/tool/run') {
    const body = await ctx.parseBody(req);
    const out = await ctx.agent.runTool(body.name, body.args || {});
    ctx.sendJson(res, 200, { ok: true, result: out });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/context/status') {
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    const out = ctx.agent.getContextStatus(sessionId);
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/context/compact') {
    const body = await ctx.parseBody(req);
    const out = ctx.agent.compactSessionContext({
      sessionId: body.sessionId,
      dryRun: Boolean(body.dryRun)
    });
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/context/compactions') {
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    const limit = Number(url.searchParams.get('limit') || 20);
    const out = ctx.agent.listContextCompactions(sessionId, limit);
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/context/artifacts') {
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    const limit = Number(url.searchParams.get('limit') || 40);
    const out = ctx.agent.listContextArtifacts(sessionId, limit);
    ctx.sendJson(res, 200, out);
    return true;
  }

  return false;
}

