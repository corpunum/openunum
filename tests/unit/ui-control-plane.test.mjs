import { describe, it, expect } from 'vitest';
import {
  CONTROL_PLANE_STATIC_ACTIONS,
  buildResearchApproveBody,
  buildModelScoutRunBody,
  buildTaskRunBody,
  parseControlPlaneBody
} from '../../src/ui/modules/control-plane.js';

describe('ui control-plane helpers', () => {
  it('exposes static action registry for control-plane quick buttons', () => {
    expect(Array.isArray(CONTROL_PLANE_STATIC_ACTIONS)).toBe(true);
    expect(CONTROL_PLANE_STATIC_ACTIONS.some((a) => a.id === 'cpMasterStatus')).toBe(true);
    expect(CONTROL_PLANE_STATIC_ACTIONS.some((a) => a.id === 'cpTaskList')).toBe(true);
  });

  it('builds control-plane payloads', () => {
    expect(buildResearchApproveBody(' https://x ', ' note ')).toEqual({ url: 'https://x', note: 'note' });
    expect(buildModelScoutRunBody(' qwen 397b ')).toEqual({ query: 'qwen 397b', monitorLocal: true });
    const task = buildTaskRunBody('verify runtime', 'http://127.0.0.1:18880');
    expect(task.goal).toBe('verify runtime');
    expect(task.verify[1].url).toBe('http://127.0.0.1:18880/api/health');
  });

  it('parses custom control-plane request body safely', () => {
    expect(parseControlPlaneBody('GET', '{"x":1}')).toEqual({ ok: true, body: undefined });
    expect(parseControlPlaneBody('POST', '{"x":1}')).toEqual({ ok: true, body: { x: 1 } });
    expect(parseControlPlaneBody('POST', '{x:1}').ok).toBe(false);
  });
});
