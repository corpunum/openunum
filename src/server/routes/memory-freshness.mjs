/**
 * Memory Freshness API Routes (R5 - Freshness Decay)
 * 
 * GET /api/memory/freshness — return freshness stats
 * GET /api/memory/stale — return stale memories
 * POST /api/memory/refresh/:id — refresh a memory
 */

import { getHalfLifeConfig, calculateFreshness, getHalfLifeForCategory } from '../../memory/freshness-decay.mjs';

/**
 * Register memory freshness routes
 * @param {object} app - Express-like app
 * @param {object} deps - Dependencies (store, ctx, etc.)
 */
export default function memoryFreshnessRoutes(app, deps) {
  const { store, ctx } = deps || {};

  /**
   * GET /api/memory/freshness
   * Return freshness statistics and configuration
   */
  if (app.get) {
    app.get('/api/memory/freshness', async (req, res) => {
      try {
        const stats = {
          ok: true,
          halfLifeConfig: getHalfLifeConfig(),
          timestamp: new Date().toISOString()
        };

        // Count memories by type if store is available
        if (store && store.db) {
          const counts = store.db.prepare(
            'SELECT artifact_type, COUNT(*) as count FROM memory_artifacts GROUP BY artifact_type'
          ).all();
          stats.memoryCounts = counts.reduce((acc, row) => {
            acc[row.artifact_type] = row.count;
            return acc;
          }, {});

          // Calculate average freshness by category
          const allMemories = store.db.prepare(
            'SELECT artifact_type, created_at FROM memory_artifacts'
          ).all();
          
          const freshnessByCategory = {};
          for (const memory of allMemories) {
            const category = memory.artifact_type;
            const createdAtMs = new Date(memory.created_at).getTime();
            const freshness = calculateFreshness(createdAtMs, getHalfLifeForCategory(category));
            
            if (!freshnessByCategory[category]) {
              freshnessByCategory[category] = { total: 0, sum: 0 };
            }
            freshnessByCategory[category].total += 1;
            freshnessByCategory[category].sum += freshness;
          }

          stats.averageFreshness = {};
          for (const [category, data] of Object.entries(freshnessByCategory)) {
            stats.averageFreshness[category] = Math.round((data.sum / data.total) * 1000) / 1000;
          }
        }

        ctx?.sendJson?.(res, 200, stats);
      } catch (error) {
        ctx?.sendJson?.(res, 500, {
          ok: false,
          error: error.message || 'freshness_stats_failed'
        });
      }
    });
  }

  /**
   * GET /api/memory/stale
   * Return stale memories sorted by staleness
   */
  if (app.get) {
    app.get('/api/memory/stale', async (req, res) => {
      try {
        const threshold = parseFloat(req.query?.threshold || '0.125');
        const limit = parseInt(req.query?.limit || '50', 10);
        const category = req.query?.category || null;

        if (!store || !store.getStaleMemories) {
          ctx?.sendJson?.(res, 503, {
            ok: false,
            error: 'store_not_available'
          });
          return;
        }

        const staleMemories = store.getStaleMemories({ threshold, limit, category });
        
        ctx?.sendJson?.(res, 200, {
          ok: true,
          staleMemories,
          count: staleMemories.length,
          threshold,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        ctx?.sendJson?.(res, 500, {
          ok: false,
          error: error.message || 'stale_memories_query_failed'
        });
      }
    });
  }

  /**
   * POST /api/memory/refresh/:id
   * Refresh a memory by updating its timestamp
   */
  if (app.post) {
    app.post('/api/memory/refresh/:id', async (req, res) => {
      try {
        const memoryId = req.params?.id || req.body?.id;
        
        if (!memoryId) {
          ctx?.sendJson?.(res, 400, {
            ok: false,
            error: 'memory_id_required'
          });
          return;
        }

        if (!store || !store.refreshMemory) {
          ctx?.sendJson?.(res, 503, {
            ok: false,
            error: 'store_not_available'
          });
          return;
        }

        const result = store.refreshMemory(memoryId);
        
        if (result && result.ok) {
          ctx?.sendJson?.(res, 200, {
            ok: true,
            ...result,
            timestamp: new Date().toISOString()
          });
        } else {
          ctx?.sendJson?.(res, 404, {
            ok: false,
            error: 'memory_not_found'
          });
        }
      } catch (error) {
        ctx?.sendJson?.(res, 500, {
          ok: false,
          error: error.message || 'refresh_memory_failed'
        });
      }
    });
  }

  return true;
}
