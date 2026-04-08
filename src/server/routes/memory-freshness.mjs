import { getHalfLifeConfig } from '../../memory/freshness-decay.mjs';

export async function handleMemoryFreshnessRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/memory/freshness') {
    const stale = typeof ctx.memory.getStaleMemories === 'function'
      ? ctx.memory.getStaleMemories({ threshold: 0.125, limit: 200 })
      : [];
    ctx.sendJson(res, 200, {
      ok: true,
      halfLifeConfig: getHalfLifeConfig(),
      staleCount: stale.length,
      timestamp: new Date().toISOString()
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/memory/stale') {
    const thresholdRaw = Number(url.searchParams.get('threshold') || 0.125);
    const limitRaw = Number(url.searchParams.get('limit') || 50);
    const threshold = Number.isFinite(thresholdRaw) ? Math.max(0, thresholdRaw) : 0.125;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 50;
    const category = String(url.searchParams.get('category') || '').trim() || null;
    const staleMemories = typeof ctx.memory.getStaleMemories === 'function'
      ? ctx.memory.getStaleMemories({ threshold, limit, category })
      : [];
    ctx.sendJson(res, 200, {
      ok: true,
      staleMemories,
      count: staleMemories.length,
      threshold,
      timestamp: new Date().toISOString()
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/memory/refresh/')) {
    const memoryId = Number(url.pathname.split('/').pop() || 0);
    if (!Number.isFinite(memoryId) || memoryId <= 0) {
      ctx.sendJson(res, 400, { ok: false, error: 'memory_id_required' });
      return true;
    }
    if (typeof ctx.memory.refreshMemory !== 'function') {
      ctx.sendJson(res, 503, { ok: false, error: 'store_not_available' });
      return true;
    }
    const out = ctx.memory.refreshMemory(memoryId);
    if (!out?.ok) {
      ctx.sendJson(res, 404, { ok: false, error: 'memory_not_found' });
      return true;
    }
    ctx.sendJson(res, 200, { ok: true, ...out, timestamp: new Date().toISOString() });
    return true;
  }

  return false;
}
