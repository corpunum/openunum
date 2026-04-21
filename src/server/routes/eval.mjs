/**
 * Eval API Routes
 *
 * Endpoints for eval results and trajectory memory.
 */

import { getEvalResults, getEvalStats } from '../../eval/runner.mjs';
import { TrajectoryMemoryStore } from '../../eval/trajectory-memory.mjs';

export async function handleEvalRoute({ req, res, url, memory, sendApiError }) {
  const pathname = url?.pathname || new URL(req.url, `http://${req.headers.host}`).pathname;

  // GET /api/eval/results
  if (req.method === 'GET' && pathname === '/api/eval/results') {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const evalRunId = params.get('evalRunId') || '';
    const limit = Number(params.get('limit') || 100);
    try {
      const results = getEvalResults(memory.db, { evalRunId: evalRunId || undefined, limit: Math.min(limit, 500) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, results, count: results.length }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
    }
    return true;
  }

  // GET /api/eval/stats
  if (req.method === 'GET' && pathname === '/api/eval/stats') {
    try {
      const stats = getEvalStats(memory.db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stats }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
    }
    return true;
  }

  // GET /api/eval/trajectory/stats
  if (req.method === 'GET' && pathname === '/api/eval/trajectory/stats') {
    try {
      const store = new TrajectoryMemoryStore({ store: memory });
      const stats = store.stats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stats }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
    }
    return true;
  }

  return false;
}
