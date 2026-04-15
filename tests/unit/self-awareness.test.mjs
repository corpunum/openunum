import { describe, expect, it } from 'vitest';
import { buildSelfAwarenessSnapshot } from '../../src/core/self-awareness.mjs';

function makeMemoryStore(sessions = [], messagesBySession = {}) {
  return {
    listSessions(limit = 12) {
      return sessions.slice(0, limit).map((sessionId) => ({ sessionId }));
    },
    getMessagesForContext(sessionId, limit = 40) {
      const rows = messagesBySession[sessionId] || [];
      return rows.slice(-limit);
    }
  };
}

describe('self-awareness snapshot', () => {
  it('marks healthy status when no low-quality patterns are present', () => {
    const store = makeMemoryStore(
      ['s1'],
      {
        s1: [
          { role: 'assistant', content: 'Here is the direct answer with evidence.' },
          { role: 'assistant', content: 'I checked the route and this is the fix.' }
        ]
      }
    );
    const out = buildSelfAwarenessSnapshot({ memoryStore: store, sessionScanLimit: 4, perSessionMessageLimit: 20 });
    expect(out.status).toBe('healthy');
    expect(out.metrics.recoveryStyleCount).toBe(0);
    expect(out.metrics.genericAckCount).toBe(0);
  });

  it('detects degraded quality when recovery and generic fallback replies are present', () => {
    const store = makeMemoryStore(
      ['s1', 's2'],
      {
        s1: [
          { role: 'assistant', content: 'Status: ok\nFindings:\nfile_search: ✅ completed' },
          { role: 'assistant', content: 'Ready. Tell me what you want to do next.' }
        ],
        s2: [
          { role: 'assistant', content: 'Status: ok\nFindings:\nfile_read: ✅ read docs' }
        ]
      }
    );
    const out = buildSelfAwarenessSnapshot({ memoryStore: store, sessionScanLimit: 4, perSessionMessageLimit: 20 });
    expect(out.status).toBe('degraded');
    expect(out.score).toBeLessThan(70);
    expect(out.metrics.recoveryStyleCount).toBeGreaterThan(0);
    expect(out.metrics.genericAckCount).toBeGreaterThan(0);
  });
});

