import crypto from 'node:crypto';
import { getTaskOrchestrator } from '../../core/autonomy-registry.mjs';
import { ensureObjectPayload, validateChatRequest } from '../contracts/request-contracts.mjs';
import { onAgentEvent, AGENT_EVENTS } from '../../core/agent-events.mjs';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ageMsFromIso(value) {
  const ts = Date.parse(String(value || ''));
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Date.now() - ts);
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
    const validation = validateChatRequest(body);
    if (!validation.ok) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: validation.errors });
      return true;
    }
    const sessionId = String(validation.value.sessionId || '').trim();
    const message = String(validation.value.message || '').trim();

    const existing = ctx.pendingChats.get(sessionId);
    if (existing) {
      const ageMs = ageMsFromIso(existing.startedAt);
      ctx.sendJson(res, 202, {
        ok: true,
        pending: true,
        sessionId,
        startedAt: existing.startedAt,
        turnId: existing.turnId,
        ageMs,
        hardTimeoutMs: ctx.chatRuntime?.hardTimeoutMs || null,
        timeoutHeadroomMs: ageMs == null ? null : Math.max(0, Number(ctx.chatRuntime?.hardTimeoutMs || 0) - ageMs),
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
        const ageMs = ageMsFromIso(existingAuto.startedAt);
        ctx.sendJson(res, 202, {
          ok: true,
          pending: true,
          sessionId,
          startedAt: existingAuto.startedAt,
          turnId: existingAuto.turnId,
          ageMs,
          hardTimeoutMs: ctx.chatRuntime?.hardTimeoutMs || null,
          timeoutHeadroomMs: ageMs == null ? null : Math.max(0, Number(ctx.chatRuntime?.hardTimeoutMs || 0) - ageMs),
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
      const turnId = crypto.randomUUID();
      ctx.pendingChats.set(sessionId, { sessionId, message, startedAt, turnId, promise });
      try {
        const out = await ctx.withTimeout(promise, 20 * 1000, 'chat_timeout');
        ctx.sendJson(res, 200, { ...out, replyHtml: ctx.renderReplyHtml(out.reply), rawReply: out.rawReply || out.reply, reasoningHtml: out.reasoning ? ctx.renderReasoningHtml(out.reasoning) : null });
        return true;
      } catch (error) {
        if (String(error.message || error) === 'chat_timeout') {
          const ageMs = ageMsFromIso(startedAt);
          ctx.sendJson(res, 202, {
            ok: true,
            pending: true,
            sessionId,
            startedAt,
            turnId,
            ageMs,
            hardTimeoutMs: ctx.chatRuntime?.hardTimeoutMs || null,
            timeoutHeadroomMs: ageMs == null ? null : Math.max(0, Number(ctx.chatRuntime?.hardTimeoutMs || 0) - ageMs),
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
      const response = { ...out, replyHtml: ctx.renderReplyHtml(out.reply), rawReply: out.rawReply || out.reply, reasoningHtml: out.reasoning ? ctx.renderReasoningHtml(out.reasoning) : null };
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
        const ageMs = ageMsFromIso(entry.startedAt);
        ctx.sendJson(res, 202, {
          ok: true,
          pending: true,
          sessionId,
          startedAt: entry.startedAt,
          turnId: entry.turnId,
          ageMs,
          hardTimeoutMs: ctx.chatRuntime?.hardTimeoutMs || null,
          timeoutHeadroomMs: ageMs == null ? null : Math.max(0, Number(ctx.chatRuntime?.hardTimeoutMs || 0) - ageMs),
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
      const completed = ctx.chatRuntime?.getCompletedChat?.(sessionId, { consume: true });
      if (completed) {
        ctx.sendJson(res, 200, {
          ok: true,
          pending: false,
          sessionId,
          completed: true,
          ...completed,
          replyHtml: completed?.reply ? ctx.renderReplyHtml(completed.reply) : null,
          rawReply: completed?.rawReply || completed?.reply || null,
          reasoningHtml: completed?.reasoning ? ctx.renderReasoningHtml(completed.reasoning) : null
        });
        return true;
      }
      ctx.sendJson(res, 200, { ok: true, pending: false, sessionId });
      return true;
    }
    const ageMs = ageMsFromIso(existing.startedAt);
    ctx.sendJson(res, 200, {
      ok: true,
      pending: true,
      sessionId,
      startedAt: existing.startedAt,
      turnId: existing.turnId,
      ageMs,
      hardTimeoutMs: ctx.chatRuntime?.hardTimeoutMs || null,
      timeoutHeadroomMs: ageMs == null ? null : Math.max(0, Number(ctx.chatRuntime?.hardTimeoutMs || 0) - ageMs),
      diagnostics: existing?.telemetry || null
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/chat/diagnostics') {
    const includeCompleted = String(url.searchParams.get('includeCompleted') || '').trim() === '1';
    const limit = Number(url.searchParams.get('limit') || 80);
    const out = ctx.chatRuntime?.getPendingDiagnostics
      ? ctx.chatRuntime.getPendingDiagnostics({ includeCompleted, limit })
      : { ok: false, error: 'chat_runtime_diagnostics_unavailable' };
    ctx.sendJson(res, out.ok ? 200 : 500, out);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/chat/stream') {
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    const since = String(url.searchParams.get('since') || '').trim();
    const turnId = String(url.searchParams.get('turnId') || '').trim();
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
    const writeEvent = (eventType, payload) => {
      if (closed) return;
      try {
        if (eventType) {
          res.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
      } catch {
        closed = true;
      }
    };

    let timer = null;
    const unsubscribers = [];
    const finalize = () => {
      if (closed) return;
      closed = true;
      if (timer) {
        try { clearInterval(timer); } catch {}
      }
      for (const unsub of unsubscribers) {
        try { unsub(); } catch {}
      }
      try { res.end(); } catch {}
    };

    // Subscribe to agent events for this session and forward as typed SSE events
    const agentEventMap = {
      [AGENT_EVENTS.CONTENT_DELTA]: 'content_delta',
      [AGENT_EVENTS.REASONING_START]: 'reasoning_start',
      [AGENT_EVENTS.REASONING_DELTA]: 'reasoning_delta',
      [AGENT_EVENTS.REASONING_END]: 'reasoning_end',
      [AGENT_EVENTS.TOOL_CALL_STARTED]: 'tool_call_started',
      [AGENT_EVENTS.TOOL_CALL_COMPLETED]: 'tool_call_completed',
      [AGENT_EVENTS.TOOL_CALL_FAILED]: 'tool_call_failed',
      [AGENT_EVENTS.TURN_END]: 'turn_end'
    };
    for (const [agentEvent, sseType] of Object.entries(agentEventMap)) {
      const unsub = onAgentEvent(agentEvent, (data) => {
        if (data.sessionId !== sessionId) return;
        writeEvent(sseType, data);
      });
      unsubscribers.push(unsub);
    }

    const readSnapshot = () => {
      const pending = ctx.pendingChats.get(sessionId);
      const startedAt = pending?.startedAt || null;
      const completed = !pending
        ? ctx.chatRuntime?.getCompletedChat?.(sessionId, { consume: false })
        : null;
      const toolRuns = typeof ctx.memory.getToolRunsSince === 'function'
        ? ctx.memory.getToolRunsSince(sessionId, since, 80)
        : [];
      const messages = typeof ctx.memory.getMessagesSince === 'function'
        ? ctx.memory.getMessagesSince(sessionId, since, 80).map(({ raw_reply, ...m }) => ({
          ...m,
          html: m.role === 'assistant' ? ctx.renderReplyHtml(m.content || '') : null
        }))
        : [];
      const matchingTurnCompleted = completed && (!turnId || completed.turnId === turnId);
      const done = Boolean(matchingTurnCompleted) || (!pending && messages.some((m) => m.role === 'assistant'));
      return {
        ok: true,
        sessionId,
        pending: Boolean(pending),
        startedAt,
        ageMs: ageMsFromIso(startedAt),
        turnId: pending?.turnId || completed?.turnId || turnId || null,
        toolRuns,
        messages,
        completed: matchingTurnCompleted
          ? {
            ...completed,
            replyHtml: completed?.reply ? ctx.renderReplyHtml(completed.reply) : null,
            rawReply: completed?.rawReply || completed?.reply || null,
            reasoning: completed?.reasoning || null,
            reasoningHtml: completed?.reasoning ? ctx.renderReasoningHtml(completed.reasoning) : null
          }
          : null,
        done,
        ts: new Date().toISOString()
      };
    };

    const pushSnapshot = () => {
      const snapshot = readSnapshot();
      writeEvent(null, snapshot);
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
    if (!ensureObjectPayload(body).ok) {
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
