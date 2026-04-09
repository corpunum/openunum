import { describe, expect, it } from 'vitest';
import { ModelBackedToolsGovernor } from '../../src/tools/backends/governor.mjs';

describe('model-backed governor', () => {
  it('runs local work serially with max concurrency 1', async () => {
    const gov = new ModelBackedToolsGovernor({ runtime: { modelBackedTools: { localMaxConcurrency: 1, queueDepth: 8 } } });
    const order = [];
    const p1 = gov.runLocal(async () => {
      order.push('a:start');
      await new Promise((r) => setTimeout(r, 15));
      order.push('a:end');
      return { ok: true };
    });
    const p2 = gov.runLocal(async () => {
      order.push('b:start');
      order.push('b:end');
      return { ok: true };
    });
    await Promise.all([p1, p2]);
    expect(order.indexOf('a:end')).toBeLessThan(order.indexOf('b:start'));
  });

  it('rejects when queue is full', async () => {
    const gov = new ModelBackedToolsGovernor({ runtime: { modelBackedTools: { localMaxConcurrency: 1, queueDepth: 1 } } });
    const hold = gov.runLocal(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true };
    });
    const queued = gov.runLocal(async () => ({ ok: true }));
    const denied = await gov.runLocal(async () => ({ ok: true }));
    await Promise.all([hold, queued]);
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe('resource_denied');
  });
});

