import { getTaskOrchestrator } from '../../core/autonomy-registry.mjs';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function summarizeTaskReply(task) {
  const lines = [
    `Autonomous task ${task.id} ${task.status}.`,
    `Goal: ${task.goal}`
  ];
  const plan = Array.isArray(task.plan) ? task.plan : [];
  if (plan.length) {
    lines.push('Plan:');
    for (const item of plan) {
      lines.push(`- [${item.status}] ${item.text}`);
    }
  }
  const steps = Array.isArray(task.stepResults) ? task.stepResults : [];
  if (steps.length) {
    lines.push('Step results:');
    for (const step of steps) {
      lines.push(`- step ${step.index + 1} ${step.kind}${step.tool ? `:${step.tool}` : ''} => ${step.result.ok ? 'ok' : `failed (${step.result.error || 'unknown'})`}`);
    }
  }
  const verification = Array.isArray(task.verification) ? task.verification : [];
  if (verification.length) {
    lines.push('Verification:');
    for (const item of verification) {
      lines.push(`- ${item.label || item.kind}: ${item.ok ? 'ok' : `failed (${item.error || 'unknown'})`}`);
    }
  }
  const monitoring = Array.isArray(task.monitoring) ? task.monitoring : [];
  if (monitoring.length) {
    lines.push('Monitoring:');
    for (const item of monitoring) {
      lines.push(`- ${item.label || item.kind}: ${item.ok ? 'ok' : `warning (${item.error || 'unknown'})`}`);
    }
  }
  if (Array.isArray(task.errors) && task.errors.length) {
    lines.push(`Errors: ${task.errors.join('; ')}`);
  }
  return lines.join('\n');
}

export async function handleChatToolsRoute({ req, res, url, ctx }) {
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
      return true;
    }
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

    if (/^\/auto\b/i.test(message)) {
      const goal = message.replace(/^\/auto\b/i, '').trim();
      if (!goal) {
        ctx.sendJson(res, 400, { error: 'auto_goal_required' });
        return true;
      }
      const baseUrl = `http://${req.headers.host || '127.0.0.1:18880'}`;
      ctx.agent.memoryStore?.addMessage(sessionId, 'user', message);
      const existingAuto = ctx.pendingChats.get(sessionId);
      if (existingAuto) {
        ctx.sendJson(res, 202, {
          ok: true,
          pending: true,
          sessionId,
          startedAt: existingAuto.startedAt,
          note: 'chat_already_running_for_session'
        });
        return true;
      }
      const startedAt = new Date().toISOString();
      const orchestrator = getTaskOrchestrator(ctx);
      const promise = orchestrator.runTask({
        goal,
        sessionId: `auto-task:${sessionId}:${Date.now()}`,
        baseUrl,
        runtime: ctx.config?.runtime
      })
        .then((out) => {
          const reply = summarizeTaskReply(out.task);
          ctx.agent.memoryStore?.addMessage(sessionId, 'assistant', reply);
          return {
            sessionId,
            reply,
            task: out.task,
            model: ctx.agent.getCurrentModel()
          };
        })
        .finally(() => {
          ctx.pendingChats.delete(sessionId);
        });
      ctx.pendingChats.set(sessionId, { sessionId, message, startedAt, promise });
      try {
        const out = await ctx.withTimeout(promise, 20 * 1000, 'chat_timeout');
        ctx.sendJson(res, 200, { ...out, replyHtml: ctx.renderReplyHtml(out.reply) });
        return true;
      } catch (error) {
        if (String(error.message || error) === 'chat_timeout') {
          ctx.sendJson(res, 202, {
            ok: true,
            pending: true,
            sessionId,
            startedAt,
            note: 'chat_still_running'
          });
          return true;
        }
        throw error;
      }
    }

    const entry = ctx.getOrStartChat(sessionId, message);
    try {
      const out = await ctx.withTimeout(entry.promise, 20 * 1000, 'chat_timeout');
      // PHASE 3: Include intervention trace in response
      const response = { ...out, replyHtml: ctx.renderReplyHtml(out.reply) };
      if (out.trace?.intervention_trace) {
        response._meta = response._meta || {};
        response._meta.interventions = {
          count: out.trace.intervention_trace.length,
          items: out.trace.intervention_trace
        };
      }
      ctx.sendJson(res, 200, response);
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

  if (req.method === 'GET' && url.pathname === '/api/chat/stream') {
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    const since = String(url.searchParams.get('since') || '').trim();
    if (!sessionId) {
      ctx.sendJson(res, 400, { error: 'sessionId is required' });
      return true;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    let closed = false;
    const writeEvent = (payload) => {
      if (closed) return;
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        closed = true;
      }
    };

    let timer = null;
    const finalize = () => {
      if (closed) return;
      closed = true;
      if (timer) {
        try { clearInterval(timer); } catch {}
      }
      try { res.end(); } catch {}
    };

    const readSnapshot = () => {
      const pending = ctx.pendingChats.get(sessionId);
      const startedAt = pending?.startedAt || null;
      const toolRuns = typeof ctx.memory.getToolRunsSince === 'function'
        ? ctx.memory.getToolRunsSince(sessionId, since, 80)
        : [];
      const messages = typeof ctx.memory.getMessagesSince === 'function'
        ? ctx.memory.getMessagesSince(sessionId, since, 80).map((m) => ({
          ...m,
          html: m.role === 'assistant' ? ctx.renderReplyHtml(m.content || '') : null
        }))
        : [];
      const done = !pending && messages.some((m) => m.role === 'assistant');
      return {
        ok: true,
        sessionId,
        pending: Boolean(pending),
        startedAt,
        toolRuns,
        messages,
        done,
        ts: new Date().toISOString()
      };
    };

    const pushSnapshot = () => {
      const snapshot = readSnapshot();
      writeEvent(snapshot);
      if (snapshot.done) finalize();
    };

    req.on('close', () => finalize());
    req.on('aborted', () => finalize());

    pushSnapshot();
    timer = setInterval(pushSnapshot, 900);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/tool/run') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
      return true;
    }
    const name = String(body.name || '').trim();
    if (!name) {
      ctx.sendJson(res, 400, { ok: false, error: 'tool_name_required' });
      return true;
    }
    const sessionId = String(body?.sessionId || '').trim() || `tool-run:${Date.now()}`;
    const out = await ctx.agent.runTool(name, body.args || {}, { sessionId });
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
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
      return true;
    }
    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId) {
      ctx.sendJson(res, 400, { ok: false, error: 'sessionId is required' });
      return true;
    }
    const out = ctx.agent.compactSessionContext({
      sessionId,
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
