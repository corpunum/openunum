import { healthTracker } from '../../providers/retry-policy.mjs';

export async function handleProvidersRoute({ req, res, url, ctx }) {
  // GET /api/providers/health — return health status of all providers
  if (req.method === 'GET' && (url.pathname === '/api/providers/health' || url.pathname === '/api/providers')) {
    const status = healthTracker.getHealthStatus();
    ctx.sendJson(res, 200, {
      ok: true,
      ...status
    });
    return true;
  }

  // POST /api/providers/:provider/reset — reset health for a provider
  if (req.method === 'POST' && url.pathname.includes('/reset')) {
    const match = url.pathname.match(/\/api\/providers\/([^/]+)\/reset/);
    if (!match) {
      ctx.sendJson(res, 400, { ok: false, error: 'Invalid path format' });
      return true;
    }

    const provider = match[1];
    healthTracker.reset(provider);

    ctx.sendJson(res, 200, {
      ok: true,
      provider,
      message: `Health tracking reset for provider '${provider}'`
    });
    return true;
  }

  return false;
}
