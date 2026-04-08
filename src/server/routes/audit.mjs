import {
  EVENT_TYPES as AUDIT_EVENT_TYPES,
  getAuditStats,
  getLog as getAuditLog,
  getMerkleRoot as getAuditRoot,
  logEvent as logAuditEvent,
  verifyChain as verifyAuditChain
} from '../../core/audit-log.mjs';

export async function handleAuditRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/audit/stats') {
    const stats = getAuditStats();
    const sessionCount = new Set(
      (getAuditLog() || [])
        .map((entry) => String(entry?.correlationId || '').trim())
        .filter(Boolean)
    ).size;
    ctx.sendJson(res, 200, {
      ...stats,
      totalLogs: stats.totalEntries || 0,
      sessionsCount: sessionCount
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/audit/log') {
    const since = String(url.searchParams.get('since') || '').trim() || null;
    const type = String(url.searchParams.get('type') || '').trim() || null;
    const limitRaw = Number(url.searchParams.get('limit') || 100);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 100;
    const entries = getAuditLog({ since, type, limit });
    ctx.sendJson(res, 200, { entries, count: entries.length });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/audit/log') {
    const body = await ctx.parseBody(req);
    const requested = String(body?.eventType || '').trim();
    const eventType = AUDIT_EVENT_TYPES.includes(requested)
      ? requested
      : 'verification';
    const payload = {
      action: String(body?.action || '').trim() || null,
      actor: String(body?.actor || '').trim() || null,
      details: body?.details && typeof body.details === 'object' ? body.details : {}
    };
    const entry = logAuditEvent(
      eventType,
      payload,
      String(body?.correlationId || '').trim() || undefined
    );
    ctx.sendJson(res, 200, {
      ok: true,
      logId: entry.entryId,
      entry
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/audit/verify') {
    ctx.sendJson(res, 200, verifyAuditChain());
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/audit/root') {
    ctx.sendJson(res, 200, { merkleRoot: getAuditRoot() });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/audit/types') {
    ctx.sendJson(res, 200, { eventTypes: AUDIT_EVENT_TYPES });
    return true;
  }

  return false;
}
