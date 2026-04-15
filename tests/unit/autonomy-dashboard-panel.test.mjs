import { describe, expect, it } from 'vitest';
import { createAutonomyDashboardPanel } from '../../src/ui/modules/autonomy-dashboard-panel.js';

function makeDom() {
  const ids = [
    'autonomySelfAwarenessValue',
    'autonomySelfAwarenessMeta',
    'autonomyQueueValue',
    'autonomyQueueMeta',
    'autonomyRemediationValue',
    'autonomyRemediationMeta',
    'autonomyDashboardSummary',
    'autonomyRemediationList',
    'autonomyQueueList',
    'autonomyRemediationId',
    'autonomyRemediationNote',
    'refreshAutonomyDashboardBtn',
    'syncAutonomyRemediationBtn',
    'startAutonomyRemediationBtn',
    'resolveAutonomyRemediationBtn',
    'failAutonomyRemediationBtn',
    'cancelAutonomyRemediationBtn'
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, { textContent: '', innerHTML: '', value: '', onclick: null }]));
  return {
    q: (id) => nodes[id] || null,
    nodes
  };
}

describe('autonomy dashboard panel', () => {
  it('renders self-awareness, queue, and remediation summary', async () => {
    const { q, nodes } = makeDom();
    const panel = createAutonomyDashboardPanel({
      q,
      jget: async (path) => {
        if (path.includes('/api/autonomy/master/status')) {
          return {
            status: {
              selfAwareness: { score: 88, status: 'healthy', sampledAt: '2026-04-13T10:00:00Z', issues: [] },
              pendingQueue: { stuckCount: 1, pendingCount: 3, oldestAgeMs: 42000, thresholdMs: 45000, stuckSessions: [{ sessionId: 's1', turnId: 't1', ageMs: 42000, startedAt: 'x' }] },
              remediation: { items: [] }
            }
          };
        }
        if (path.includes('/api/autonomy/remediations')) {
          return {
            items: [{ id: 'rem-1', title: 'Fix drift', status: 'queued', severity: 'warning', observedCount: 2, updatedAt: 'now' }]
          };
        }
        if (path.includes('/api/chat/diagnostics')) {
          return { pendingCount: 3, stuckCount: 1 };
        }
        return {};
      },
      jpost: async () => ({ ok: true }),
      escapeHtml: (v) => String(v || ''),
      setStatus: () => {}
    });

    await panel.refreshAutonomyDashboard();
    expect(nodes.autonomySelfAwarenessValue.textContent).toContain('88');
    expect(nodes.autonomyQueueValue.textContent).toContain('1 stuck');
    expect(nodes.autonomyRemediationValue.textContent).toContain('1 items');
    expect(nodes.autonomyDashboardSummary.textContent).toContain('selfAwareness=');
    expect(nodes.autonomyRemediationList.innerHTML).toContain('Fix drift');
    expect(nodes.autonomyQueueList.innerHTML).toContain('session=s1');
  });
});

