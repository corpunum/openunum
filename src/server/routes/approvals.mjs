/**
 * Approvals API Routes
 * 
 * POST /api/approvals/request - Request approval for a blocked action
 * GET /api/approvals/pending - List pending approval requests
 * POST /api/approvals/:id/approve - Approve a pending request
 * POST /api/approvals/:id/deny - Deny a pending request
 */

// In-memory store for approval requests
const approvalStore = new Map();
let approvalIdCounter = 1;

/**
 * Generate a unique approval ID
 */
function generateApprovalId() {
  return `approval-${Date.now()}-${approvalIdCounter++}`;
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export default function handleApprovalsRoute(app, deps = {}) {
  // POST /api/approvals/request - Request approval for a blocked action
  app.post('/api/approvals/request', (req, res) => {
    try {
      const { toolName, confidence, tier, reason, context } = req.body;
      
      if (!toolName) {
        return res.status(400).json({ error: 'toolName is required' });
      }
      
      const approvalId = generateApprovalId();
      const request = {
        id: approvalId,
        toolName,
        confidence: confidence || 0,
        tier: tier || 'balanced',
        reason: reason || 'low_confidence_blocked',
        context: context || {},
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      approvalStore.set(approvalId, request);
      
      return res.status(201).json({
        approvalId,
        status: 'pending',
        message: 'Approval request created',
        request
      });
    } catch (err) {
      console.error('[/api/approvals/request] Error:', err);
      return res.status(500).json({ error: 'Failed to create approval request', details: err.message });
    }
  });

  // GET /api/approvals/pending - List pending approval requests
  app.get('/api/approvals/pending', (req, res) => {
    try {
      const pending = Array.from(approvalStore.values())
        .filter(req => req.status === 'pending')
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      
      return res.status(200).json({
        pending,
        count: pending.length
      });
    } catch (err) {
      console.error('[/api/approvals/pending] Error:', err);
      return res.status(500).json({ error: 'Failed to list pending approvals', details: err.message });
    }
  });

  // GET /api/approvals/:id - Get a specific approval request
  app.get('/api/approvals/:id', (req, res) => {
    try {
      const { id } = req.params;
      const request = approvalStore.get(id);
      
      if (!request) {
        return res.status(404).json({ error: 'Approval request not found' });
      }
      
      return res.status(200).json(request);
    } catch (err) {
      console.error('[/api/approvals/:id] Error:', err);
      return res.status(500).json({ error: 'Failed to get approval request', details: err.message });
    }
  });

  // POST /api/approvals/:id/approve - Approve a pending request
  app.post('/api/approvals/:id/approve', (req, res) => {
    try {
      const { id } = req.params;
      const request = approvalStore.get(id);
      
      if (!request) {
        return res.status(404).json({ error: 'Approval request not found' });
      }
      
      if (request.status !== 'pending') {
        return res.status(400).json({ error: `Cannot approve request with status: ${request.status}` });
      }
      
      request.status = 'approved';
      request.updatedAt = new Date().toISOString();
      approvalStore.set(id, request);
      
      return res.status(200).json({
        approvalId: id,
        status: 'approved',
        message: 'Approval request approved',
        request
      });
    } catch (err) {
      console.error('[/api/approvals/:id/approve] Error:', err);
      return res.status(500).json({ error: 'Failed to approve request', details: err.message });
    }
  });

  // POST /api/approvals/:id/deny - Deny a pending request
  app.post('/api/approvals/:id/deny', (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const request = approvalStore.get(id);
      
      if (!request) {
        return res.status(404).json({ error: 'Approval request not found' });
      }
      
      if (request.status !== 'pending') {
        return res.status(400).json({ error: `Cannot deny request with status: ${request.status}` });
      }
      
      request.status = 'denied';
      request.deniedReason = reason || 'No reason provided';
      request.updatedAt = new Date().toISOString();
      approvalStore.set(id, request);
      
      return res.status(200).json({
        approvalId: id,
        status: 'denied',
        deniedReason: request.deniedReason,
        message: 'Approval request denied',
        request
      });
    } catch (err) {
      console.error('[/api/approvals/:id/deny] Error:', err);
      return res.status(500).json({ error: 'Failed to deny request', details: err.message });
    }
  });

  // GET /api/approvals/stats - Get approval statistics
  app.get('/api/approvals/stats', (req, res) => {
    try {
      const all = Array.from(approvalStore.values());
      const pending = all.filter(r => r.status === 'pending');
      const approved = all.filter(r => r.status === 'approved');
      const denied = all.filter(r => r.status === 'denied');
      
      return res.status(200).json({
        total: all.length,
        pending: pending.length,
        approved: approved.length,
        denied: denied.length,
        byTool: all.reduce((acc, r) => {
          acc[r.toolName] = (acc[r.toolName] || 0) + 1;
          return acc;
        }, {})
      });
    } catch (err) {
      console.error('[/api/approvals/stats] Error:', err);
      return res.status(500).json({ error: 'Failed to get approval stats', details: err.message });
    }
  });

  return true;
}

// Export for testing
export { approvalStore };
