import { getRegistry } from '../../commands/registry.mjs';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function handleCommandRoute({ req, res, url, ctx }) {
  if (!(req.method === 'POST' && url.pathname === '/api/command')) return false;

  const body = await ctx.parseBody(req);
  if (!isPlainObject(body)) {
    ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
    return true;
  }
  const message = String(body.message || '').trim();
  if (!message) {
    ctx.sendJson(res, 400, { error: 'message field is required' });
    return true;
  }

  const registry = getRegistry();
  const result = await registry.route(message, {
    sessionId: String(body.sessionId || 'api'),
    agent: ctx.agent,
    memoryStore: ctx.memoryStore,
    config: ctx.config
  });
  ctx.sendJson(res, result?.handled ? 200 : 404, result || { handled: false });
  return true;
}

export async function handleCommandsListRoute({ req, res, url, ctx }) {
  if (!(req.method === 'GET' && url.pathname === '/api/commands')) return false;

  const registry = getRegistry();
  ctx.sendJson(res, 200, { commands: registry.list() });
  return true;
}

export default { handleCommandRoute, handleCommandsListRoute };
