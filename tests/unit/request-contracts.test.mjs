import { describe, expect, it } from 'vitest';
import {
  validateAuthCatalogRequest,
  validateChatRequest,
  validateConfigPatch,
  validateMissionScheduleUpdateRequest,
  validateMissionStartRequest,
  validateProvidersConfigPatch
} from '../../src/server/contracts/request-contracts.mjs';

describe('request-contracts', () => {
  it('validates config patch provider ids and ranges', () => {
    const bad = validateConfigPatch({
      model: { provider: 'unknown-provider' },
      runtime: { maxToolIterations: 999 }
    }, {
      normalizeProviderId: (p) => String(p || '').trim().toLowerCase()
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.field === 'model.provider')).toBe(true);
    expect(bad.errors.some((e) => e.field === 'runtime.maxToolIterations')).toBe(true);

    const good = validateConfigPatch({ model: { provider: 'OpenAI' } }, {
      normalizeProviderId: (p) => String(p || '').trim().toLowerCase()
    });
    expect(good.ok).toBe(true);
  });

  it('validates providers config urls', () => {
    const out = validateProvidersConfigPatch({ openrouterBaseUrl: 'notaurl' });
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.field === 'openrouterBaseUrl')).toBe(true);
  });

  it('requires sessionId and message for chat', () => {
    const out = validateChatRequest({ sessionId: 'abc' });
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.field === 'message')).toBe(true);
  });

  it('validates mission inputs', () => {
    const start = validateMissionStartRequest({ goal: 'do it', maxRetries: -1 });
    expect(start.ok).toBe(false);
    expect(start.errors.some((e) => e.field === 'maxRetries')).toBe(true);

    const update = validateMissionScheduleUpdateRequest({ id: 's1', intervalMs: 5 });
    expect(update.ok).toBe(false);
    expect(update.errors.some((e) => e.field === 'intervalMs')).toBe(true);
  });

  it('validates auth catalog payload shape', () => {
    const out = validateAuthCatalogRequest({ clear: [1, 2, 3] });
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.field === 'clear')).toBe(true);
  });
});
