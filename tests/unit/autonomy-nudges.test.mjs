import { describe, expect, it } from 'vitest';
import { buildAutonomyNudges } from '../../src/core/autonomy-nudges.mjs';
import { defaultConfig } from '../../src/config.mjs';

describe('buildAutonomyNudges', () => {
  it('creates review nudges for degraded health, overloaded sessions, and timeout clusters', () => {
    const config = defaultConfig();
    const memoryStore = {
      listSessions() {
        return [{ sessionId: 's1', title: 'timeout thread', preview: 'provider failures' }];
      },
      getMessagesForContext() {
        return [{ role: 'user', content: 'x'.repeat(70000) }];
      },
      getRecentToolRuns() {
        return [
          { result: { error: 'provider_timeout' } },
          { result: { error: 'provider_timeout' } }
        ];
      }
    };
    const nudges = buildAutonomyNudges({
      config,
      memoryStore,
      health: {
        status: 'degraded',
        issues: [{ check: 'browser', error: 'cdp_down' }]
      }
    });

    expect(nudges.some((item) => item.type === 'health_issue')).toBe(true);
    expect(nudges.some((item) => item.type === 'session_overloaded')).toBe(true);
    expect(nudges.some((item) => item.type === 'provider_timeout_cluster')).toBe(true);
    expect(nudges.some((item) => item.type === 'meta_harness_review')).toBe(true);
  });
});
