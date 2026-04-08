import { describe, it, expect } from 'vitest';
import {
  buildClearAllSessionsPayload,
  buildSessionExportFilename,
  buildSessionExportStatus,
  buildSessionImportRequest,
  buildSessionImportStatus,
  buildMissionCloneStatus
} from '../../src/ui/modules/session-io.js';

describe('ui session io helpers', () => {
  it('builds clear/export helpers', () => {
    expect(buildClearAllSessionsPayload()).toEqual({ force: true, keepSessionId: '' });
    expect(buildSessionExportFilename('abc')).toBe('openunum-session-abc.json');
    expect(buildSessionExportStatus({ messages: [{}, {}], estimatedTokens: 55 })).toContain('messages=2');
  });

  it('builds import/clone helpers', () => {
    const req = buildSessionImportRequest({ messages: [{ role: 'user', content: 'hi' }] }, 'sid-1');
    expect(req.sessionId).toBe('sid-1');
    expect(Array.isArray(req.messages)).toBe(true);
    expect(buildSessionImportStatus('sid-1', { session: { messageCount: 7 } })).toContain('messages=7');
    expect(buildMissionCloneStatus('s1', 's2')).toBe('mission session cloned | s1 -> s2');
  });
});
