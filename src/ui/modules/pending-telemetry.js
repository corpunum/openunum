function toMs(iso) {
  const n = Date.parse(String(iso || ''));
  return Number.isFinite(n) ? n : null;
}

export function createPendingTelemetry(startedAtIso = '') {
  const startedAtMs = toMs(startedAtIso) ?? Date.now();
  return {
    startedAtMs,
    firstActivityMs: null,
    pendingClearedMs: null,
    finalMessageMs: null
  };
}

export function markPendingTelemetryActivity(telemetry, nowMs = Date.now()) {
  if (!telemetry || telemetry.firstActivityMs != null) return telemetry;
  telemetry.firstActivityMs = nowMs;
  return telemetry;
}

export function markPendingTelemetryCleared(telemetry, nowMs = Date.now()) {
  if (!telemetry || telemetry.pendingClearedMs != null) return telemetry;
  telemetry.pendingClearedMs = nowMs;
  return telemetry;
}

export function markPendingTelemetryFinal(telemetry, nowMs = Date.now()) {
  if (!telemetry || telemetry.finalMessageMs != null) return telemetry;
  telemetry.finalMessageMs = nowMs;
  return telemetry;
}

export function summarizePendingTelemetry(telemetry) {
  if (!telemetry?.startedAtMs) return null;
  const firstActivityMs = telemetry.firstActivityMs ?? null;
  const pendingClearedMs = telemetry.pendingClearedMs ?? null;
  const finalMessageMs = telemetry.finalMessageMs ?? null;
  const totalMs = finalMessageMs != null ? Math.max(0, finalMessageMs - telemetry.startedAtMs) : null;
  const firstActivityDelayMs = firstActivityMs != null ? Math.max(0, firstActivityMs - telemetry.startedAtMs) : null;
  const postPendingTailMs = (pendingClearedMs != null && finalMessageMs != null)
    ? Math.max(0, finalMessageMs - pendingClearedMs)
    : null;
  return { totalMs, firstActivityDelayMs, postPendingTailMs };
}

export function formatPendingTelemetrySummary(summary) {
  if (!summary) return '';
  const total = summary.totalMs != null ? `${Math.round(summary.totalMs)}ms` : '-';
  const first = summary.firstActivityDelayMs != null ? `${Math.round(summary.firstActivityDelayMs)}ms` : '-';
  const tail = summary.postPendingTailMs != null ? `${Math.round(summary.postPendingTailMs)}ms` : '-';
  return `pending timing total=${total} firstActivity=${first} tail=${tail}`;
}
