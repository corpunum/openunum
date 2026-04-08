export async function handleSessionsRoute({ req, res, url, ctx }) {
  const getRuntimeState = ({ sessionId = '', goal = '', phase = 'phase0', nextAction = '' } = {}) => {
    if (typeof ctx.buildRuntimeStateAttachment !== 'function') return null;
    return ctx.buildRuntimeStateAttachment({ sessionId, goal, phase, nextAction });
  };

  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    const limit = Number(url.searchParams.get('limit') || 80);
    ctx.sendJson(res, 200, { sessions: ctx.memory.listSessions(limit) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const body = await ctx.parseBody(req);
    const sessionId = String(body?.sessionId || '').trim();
    if (!sessionId) {
      ctx.sendApiError(res, 400, 'session_id_required', 'sessionId is required');
      return true;
    }
    const session = ctx.memory.createSession(sessionId);
    ctx.sendJson(res, 200, {
      ok: true,
      session,
      runtimeState: getRuntimeState({
        sessionId,
        goal: `session:${sessionId}`,
        nextAction: 'Continue session workflow'
      })
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions/import') {
    const body = await ctx.parseBody(req);
    const imported = ctx.memory.importSession({
      sessionId: String(body?.sessionId || '').trim(),
      messages: Array.isArray(body?.messages) ? body.messages : []
    });
    ctx.sendJson(res, 200, {
      ok: true,
      session: imported,
      runtimeState: getRuntimeState({
        sessionId: String(imported?.sessionId || body?.sessionId || '').trim(),
        goal: `session-import:${String(imported?.sessionId || body?.sessionId || '').trim()}`,
        nextAction: 'Validate imported session and continue'
      })
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions/clone') {
    const body = await ctx.parseBody(req);
    const session = ctx.memory.cloneSession({
      sourceSessionId: String(body?.sourceSessionId || '').trim(),
      targetSessionId: String(body?.targetSessionId || '').trim()
    });
    ctx.sendJson(res, 200, {
      ok: true,
      session,
      runtimeState: getRuntimeState({
        sessionId: String(session?.sessionId || body?.targetSessionId || '').trim(),
        goal: `session-clone:${String(session?.sessionId || body?.targetSessionId || '').trim()}`,
        nextAction: 'Use cloned session for continued execution'
      })
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions/clear') {
    const body = await ctx.parseBody(req);
    const keepSessionId = String(body?.keepSessionId || '').trim();
    const force = Boolean(body?.force);
    const operationId = String(body?.operationId || '').trim();
    if (!keepSessionId && !force) {
      ctx.sendApiError(
        res,
        400,
        'keep_session_required',
        'keepSessionId is required unless force=true'
      );
      return true;
    }
    const out = ctx.memory.clearSessions({ keepSessionId, operationId });
    const pendingRemoved = ctx.prunePendingChats({ keepSessionId });
    ctx.sendJson(res, 200, { ok: true, ...out, pendingRemoved });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/sessions/')) {
    const parts = url.pathname.split('/');
    const sessionId = decodeURIComponent(parts[3] || '');
    if (!sessionId || parts.length !== 4) {
      ctx.sendApiError(res, 400, 'session_id_required', 'sessionId is required');
      return true;
    }
    const operationId = String(url.searchParams.get('operationId') || '').trim();
    const out = ctx.memory.deleteSession(sessionId, { operationId });
    const pendingRemoved = ctx.pendingChats.delete(sessionId) ? 1 : 0;
    ctx.sendJson(res, 200, { ok: true, ...out, pendingRemoved });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/operations/recent') {
    const limit = Number(url.searchParams.get('limit') || 50);
    ctx.sendJson(res, 200, {
      contract_version: '2026-04-02.operation-receipts.v1',
      receipts: ctx.memory.listOperationReceipts(limit)
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
    if (url.pathname.endsWith('/activity')) {
      const parts = url.pathname.split('/');
      const sessionId = decodeURIComponent(parts[3] || '');
      const since = String(url.searchParams.get('since') || '');
      const pending = ctx.pendingChats.get(sessionId);
      const toolRuns = ctx.memory.getToolRunsSince(sessionId, since, 80);
      const messages = ctx.memory.getMessagesSince(sessionId, since, 80)
        .map((m) => ({
          ...m,
          html: m.role === 'assistant' ? ctx.renderReplyHtml(m.content || '') : null
        }));
      ctx.sendJson(res, 200, {
        sessionId,
        since: since || null,
        pending: Boolean(pending),
        pendingStartedAt: pending?.startedAt || null,
        toolRuns,
        messages,
        runtimeState: getRuntimeState({
          sessionId,
          goal: `session-activity:${sessionId}`,
          nextAction: 'Inspect activity deltas'
        })
      });
      return true;
    }
    if (url.pathname.endsWith('/export')) {
      const parts = url.pathname.split('/');
      const sessionId = decodeURIComponent(parts[3] || '');
      const summary = ctx.memory.getSessionSummary(sessionId);
      if (!summary) {
        ctx.sendJson(res, 404, { error: 'session_not_found' });
        return true;
      }
      const messages = ctx.memory.getAllMessagesForSession(sessionId);
      ctx.sendJson(res, 200, {
        sessionId,
        summary,
        exportedAt: new Date().toISOString(),
        estimatedTokens: ctx.estimateMessagesTokens(messages.map((m) => ({ role: m.role, content: m.content }))),
        messages,
        runtimeState: getRuntimeState({
          sessionId,
          goal: summary.title || `session-export:${sessionId}`,
          nextAction: 'Review exported session transcript'
        })
      });
      return true;
    }
    // PHASE 3: Intervention Trace endpoint
    if (url.pathname.endsWith('/trace')) {
      const parts = url.pathname.split('/');
      const sessionId = decodeURIComponent(parts[3] || '');
      const summary = ctx.memory.getSessionSummary(sessionId);
      if (!summary) {
        ctx.sendJson(res, 404, { error: 'session_not_found' });
        return true;
      }
      // Get trace from pending chats (active session trace)
      const pending = ctx.pendingChats.get(sessionId);
      const trace = pending?.trace || null;
      
      // Get intervention history from messages (look for system messages with intervention markers)
      const messages = ctx.memory.getAllMessagesForSession(sessionId);
      const interventions = messages
        .filter(m => m.role === 'system' && (
          m.content.includes('DRIFT DETECTION') ||
          m.content.includes('CONTINUATION INSTRUCTION') ||
          m.content.includes('WORKING MEMORY ANCHOR') ||
          m.content.includes('Preventive continuation') ||
          m.content.includes('completion checklist')
        ))
        .map((m, idx) => ({
          id: `intervention-${idx}`,
          type: m.content.includes('DRIFT') ? 'drift_correction' :
                m.content.includes('CONTINUATION') ? 'continuation' :
                m.content.includes('ANCHOR') ? 'anchor_injection' :
                m.content.includes('Preventive') ? 'preventive_continuation' :
                m.content.includes('checklist') ? 'checklist_enforcement' : 'unknown',
          messageId: m.id,
          createdAt: m.created_at,
          preview: String(m.content).slice(0, 200)
        }));
      
      ctx.sendJson(res, 200, {
        sessionId,
        trace: {
          active: trace,
          interventions: {
            count: interventions.length,
            items: interventions.slice(-50)  // Last 50 interventions
          }
        },
        runtimeState: getRuntimeState({
          sessionId,
          goal: `session-trace:${sessionId}`,
          nextAction: 'Review interventions and continue mission safely'
        })
      });
      return true;
    }
    const sessionId = decodeURIComponent(url.pathname.split('/').pop() || '');
    const skipHtml = url.searchParams.get('html') === 'false';
    const msgs = ctx.memory.getMessages(sessionId || '', 500)
      .map((m) => ({
        ...m,
        html: (!skipHtml && m.role === 'assistant') ? ctx.renderReplyHtml(m.content || '') : null
      }));
    ctx.sendJson(res, 200, {
      sessionId,
      messages: msgs,
      runtimeState: getRuntimeState({
        sessionId,
        goal: `session:${sessionId}`,
        nextAction: 'Continue chat execution'
      })
    });
    return true;
  }

  return false;
}
