import { describe, it, expect, vi } from 'vitest';
import { handleSessionsRoute } from '../../src/server/routes/sessions.mjs';
import { handleMissionsRoute } from '../../src/server/routes/missions.mjs';

function makeReq(method) {
  return { method };
}

function makeUrl(path) {
  return new URL(`http://localhost${path}`);
}

describe('route runtime-state wiring', () => {
  it('adds runtimeState to session create response', async () => {
    const sendJson = vi.fn();
    const parseBody = vi.fn().mockResolvedValue({ sessionId: 's-1' });
    const memory = {
      createSession: vi.fn().mockReturnValue({ sessionId: 's-1', messageCount: 0 })
    };

    const handled = await handleSessionsRoute({
      req: makeReq('POST'),
      res: {},
      url: makeUrl('/api/sessions'),
      ctx: {
        memory,
        parseBody,
        sendJson,
        sendApiError: vi.fn(),
        pendingChats: new Map(),
        prunePendingChats: vi.fn(),
        estimateMessagesTokens: vi.fn(),
        renderReplyHtml: vi.fn(),
        buildRuntimeStateAttachment: vi.fn().mockReturnValue({
          contractVersion: '2026-04-08.runtime-state.v1',
          validationOk: true,
          fingerprint: 'abc',
          state: { sessionId: 's-1' }
        })
      }
    });

    expect(handled).toBe(true);
    expect(sendJson).toHaveBeenCalledWith(
      {},
      200,
      expect.objectContaining({
        ok: true,
        runtimeState: expect.objectContaining({
          contractVersion: '2026-04-08.runtime-state.v1',
          validationOk: true
        })
      })
    );
  });

  it('adds runtimeState to mission status response', async () => {
    const sendJson = vi.fn();
    const mission = {
      id: 'm-1',
      goal: 'test goal',
      sessionId: 'mission:m-1',
      status: 'running'
    };
    const missions = {
      get: vi.fn().mockReturnValue(mission)
    };

    const handled = await handleMissionsRoute({
      req: makeReq('GET'),
      res: {},
      url: makeUrl('/api/missions/status?id=m-1'),
      ctx: {
        missions,
        sendJson,
        parseBody: vi.fn(),
        buildMissionTimeline: vi.fn(),
        buildRuntimeStateAttachment: vi.fn().mockReturnValue({
          contractVersion: '2026-04-08.runtime-state.v1',
          validationOk: true,
          fingerprint: 'def',
          state: { sessionId: 'mission:m-1' }
        })
      }
    });

    expect(handled).toBe(true);
    expect(sendJson).toHaveBeenCalledWith(
      {},
      200,
      expect.objectContaining({
        mission: expect.objectContaining({
          ...mission,
          effectiveStepLimit: 6,
          limitSource: 'hardStepCap'
        }),
        runtimeState: expect.objectContaining({
          contractVersion: '2026-04-08.runtime-state.v1',
          validationOk: true
        })
      })
    );
  });
});
