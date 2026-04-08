import { describe, it, expect } from 'vitest';
import {
  createPendingTelemetry,
  markPendingTelemetryActivity,
  markPendingTelemetryCleared,
  markPendingTelemetryFinal,
  summarizePendingTelemetry,
  formatPendingTelemetrySummary
} from '../../src/ui/modules/pending-telemetry.js';

describe('ui pending telemetry helpers', () => {
  it('tracks and summarizes pending timing phases', () => {
    const t = createPendingTelemetry('2026-04-08T00:00:00.000Z');
    markPendingTelemetryActivity(t, Date.parse('2026-04-08T00:00:00.500Z'));
    markPendingTelemetryCleared(t, Date.parse('2026-04-08T00:00:01.000Z'));
    markPendingTelemetryFinal(t, Date.parse('2026-04-08T00:00:01.300Z'));
    const s = summarizePendingTelemetry(t);
    expect(s.totalMs).toBe(1300);
    expect(s.firstActivityDelayMs).toBe(500);
    expect(s.postPendingTailMs).toBe(300);
    expect(formatPendingTelemetrySummary(s)).toContain('tail=300ms');
  });
});
