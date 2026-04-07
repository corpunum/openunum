/**
 * Audit Log API Routes
 * 
 * GET /api/audit/log — list entries (query: since, type, limit)
 * GET /api/audit/verify — verify chain integrity
 * GET /api/audit/root — return current merkle root
 */

import {
  logEvent,
  verifyChain,
  getLog,
  getMerkleRoot,
  getAuditStats,
  EVENT_TYPES
} from '../../core/audit-log.mjs';

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export default function handleAuditRoute(app, deps = {}) {
  // GET /api/audit/log — list entries
  app.get('/api/audit/log', (req, res) => {
    try {
      const { since, type, limit } = req.query;
      
      // Validate type if provided
      if (type && !EVENT_TYPES.includes(type)) {
        return res.status(400).json({
          error: 'Invalid event type',
          validTypes: EVENT_TYPES
        });
      }
      
      const entries = getLog({
        since: since || null,
        type: type || null,
        limit: limit ? parseInt(limit, 10) : null
      });
      
      return res.status(200).json({
        entries,
        count: entries.length,
        query: { since, type, limit: limit ? parseInt(limit, 10) : null }
      });
    } catch (err) {
      console.error('[/api/audit/log] Error:', err);
      return res.status(500).json({ error: 'Failed to retrieve audit log', details: err.message });
    }
  });

  // POST /api/audit/log — create a new entry
  app.post('/api/audit/log', (req, res) => {
    try {
      const { eventType, payload, correlationId } = req.body;
      
      if (!eventType) {
        return res.status(400).json({ error: 'eventType is required' });
      }
      
      if (!EVENT_TYPES.includes(eventType)) {
        return res.status(400).json({
          error: 'Invalid event type',
          validTypes: EVENT_TYPES
        });
      }
      
      const entry = logEvent(eventType, payload || {}, correlationId);
      
      return res.status(201).json({
        entryId: entry.entryId,
        timestamp: entry.timestamp,
        eventType: entry.eventType,
        correlationId: entry.correlationId,
        previousHash: entry.previousHash,
        currentHash: entry.currentHash,
        payload: entry.payload
      });
    } catch (err) {
      console.error('[/api/audit/log POST] Error:', err);
      return res.status(500).json({ error: 'Failed to create audit entry', details: err.message });
    }
  });

  // GET /api/audit/verify — verify chain integrity
  app.get('/api/audit/verify', (req, res) => {
    try {
      const result = verifyChain();
      
      return res.status(200).json({
        valid: result.valid,
        brokenAt: result.brokenAt,
        totalEntries: result.entries.length,
        verifiedAt: new Date().toISOString(),
        merkleRoot: getMerkleRoot()
      });
    } catch (err) {
      console.error('[/api/audit/verify] Error:', err);
      return res.status(500).json({ error: 'Failed to verify audit chain', details: err.message });
    }
  });

  // GET /api/audit/root — return current merkle root
  app.get('/api/audit/root', (req, res) => {
    try {
      const root = getMerkleRoot();
      const stats = getAuditStats();
      
      return res.status(200).json({
        merkleRoot: root,
        totalEntries: stats.totalEntries,
        computedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('[/api/audit/root] Error:', err);
      return res.status(500).json({ error: 'Failed to get merkle root', details: err.message });
    }
  });

  // GET /api/audit/stats — get audit statistics
  app.get('/api/audit/stats', (req, res) => {
    try {
      const stats = getAuditStats();
      
      return res.status(200).json({
        ...stats,
        eventTypes: EVENT_TYPES
      });
    } catch (err) {
      console.error('[/api/audit/stats] Error:', err);
      return res.status(500).json({ error: 'Failed to get audit stats', details: err.message });
    }
  });

  // GET /api/audit/types — get valid event types
  app.get('/api/audit/types', (req, res) => {
    return res.status(200).json({
      eventTypes: EVENT_TYPES
    });
  });

  return true;
}
