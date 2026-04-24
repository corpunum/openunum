import { describe, expect, it } from 'vitest';
import { compileLunumShadowContext, deriveLunumSidecar } from '../../src/memory/lunum.mjs';

describe('lunum memory sidecar', () => {
  it('derives telegraph sidecar for plain conversational text', () => {
    const sidecar = deriveLunumSidecar({
      role: 'user',
      content: 'Can you summarize the latest deployment status for project Atlas?'
    });
    expect(sidecar.lunumCode).toMatch(/^q /);
    expect(sidecar.lunumFp).toHaveLength(20);
    expect(sidecar.lunumMeta?.eligible).toBe(true);
  });

  it('marks structured payloads as ineligible', () => {
    const sidecar = deriveLunumSidecar({
      role: 'assistant',
      content: '```json\n{"status":"ok"}\n```'
    });
    expect(sidecar.lunumCode).toBeNull();
    expect(sidecar.lunumMeta?.eligible).toBe(false);
  });

  it('computes mixed-vs-natural ratio from persisted rows', () => {
    const out = compileLunumShadowContext([
      {
        role: 'user',
        content: 'Please schedule the deployment for tomorrow at 10am.',
        lunum_code: 'schedule deployment tomorrow 10am',
        lunum_meta_json: JSON.stringify({ eligible: true })
      },
      {
        role: 'assistant',
        content: 'Deployment scheduled. I will notify the team.',
        lunum_code: null,
        lunum_meta_json: null
      }
    ]);
    expect(out.naturalMessages).toBe(2);
    expect(out.ratio).toBeGreaterThan(0);
    expect(out.ratio).toBeLessThanOrEqual(1);
  });
});
