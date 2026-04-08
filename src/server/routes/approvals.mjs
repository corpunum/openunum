// In-memory store for approval requests.
const approvalStore = new Map();
let approvalIdCounter = 1;

function generateApprovalId() {
  return `approval-${Date.now()}-${approvalIdCounter++}`;
}

function getRequestIdFromPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'approvals') return null;
  return parts[2] || null;
}

export async function handleApprovalsRoute({ req, res, url, ctx }) {
  if (req.method === 'POST' && url.pathname === '/api/approvals/request') {
    const body = await ctx.parseBody(req);
    const toolName = String(body?.toolName || '').trim();
    if (!toolName) {
      ctx.sendJson(res, 400, { error: 'toolName is required' });
      return true;
    }
    const approvalId = generateApprovalId();
    const request = {
      id: approvalId,
      toolName,
      confidence: Number.isFinite(body?.confidence) ? Number(body.confidence) : 0,
      tier: String(body?.tier || 'balanced').trim() || 'balanced',
      reason: String(body?.reason || 'low_confidence_blocked').trim() || 'low_confidence_blocked',
      context: body?.context && typeof body.context === 'object' ? body.context : {},
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    approvalStore.set(approvalId, request);
    ctx.sendJson(res, 201, {
      approvalId,
      status: 'pending',
      message: 'Approval request created',
      request
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/approvals/pending') {
    const pending = Array.from(approvalStore.values())
      .filter((item) => item.status === 'pending')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    ctx.sendJson(res, 200, {
      pending,
      count: pending.length
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/approvals/stats') {
    const all = Array.from(approvalStore.values());
    const pending = all.filter((item) => item.status === 'pending').length;
    const approved = all.filter((item) => item.status === 'approved').length;
    const denied = all.filter((item) => item.status === 'denied').length;
    const byTool = all.reduce((acc, item) => {
      acc[item.toolName] = (acc[item.toolName] || 0) + 1;
      return acc;
    }, {});
    ctx.sendJson(res, 200, {
      total: all.length,
      pending,
      approved,
      denied,
      byTool
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/approvals/')) {
    const id = getRequestIdFromPath(url.pathname);
    if (!id || ['pending', 'stats'].includes(id)) return false;
    const request = approvalStore.get(id);
    if (!request) {
      ctx.sendJson(res, 404, { error: 'Approval request not found' });
      return true;
    }
    ctx.sendJson(res, 200, request);
    return true;
  }

  if (req.method === 'POST' && /^\/api\/approvals\/[^/]+\/approve$/.test(url.pathname)) {
    const id = getRequestIdFromPath(url.pathname);
    const request = approvalStore.get(String(id || ''));
    if (!request) {
      ctx.sendJson(res, 404, { error: 'Approval request not found' });
      return true;
    }
    if (request.status !== 'pending') {
      ctx.sendJson(res, 400, { error: `Cannot approve request with status: ${request.status}` });
      return true;
    }
    request.status = 'approved';
    request.updatedAt = new Date().toISOString();
    approvalStore.set(id, request);
    ctx.sendJson(res, 200, {
      approvalId: id,
      status: 'approved',
      message: 'Approval request approved',
      request
    });
    return true;
  }

  if (req.method === 'POST' && /^\/api\/approvals\/[^/]+\/deny$/.test(url.pathname)) {
    const id = getRequestIdFromPath(url.pathname);
    const request = approvalStore.get(String(id || ''));
    if (!request) {
      ctx.sendJson(res, 404, { error: 'Approval request not found' });
      return true;
    }
    if (request.status !== 'pending') {
      ctx.sendJson(res, 400, { error: `Cannot deny request with status: ${request.status}` });
      return true;
    }
    const body = await ctx.parseBody(req);
    request.status = 'denied';
    request.deniedReason = String(body?.reason || 'No reason provided');
    request.updatedAt = new Date().toISOString();
    approvalStore.set(id, request);
    ctx.sendJson(res, 200, {
      approvalId: id,
      status: 'denied',
      deniedReason: request.deniedReason,
      message: 'Approval request denied',
      request
    });
    return true;
  }

  return false;
}

export { approvalStore };
