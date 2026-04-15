import crypto from 'node:crypto';

export function createChatRuntimeService({ agent, saveConfig, config }) {
  const pendingChats = new Map();
  const completedChats = new Map();
  const completedTtlMs = Math.max(5000, Number(config?.runtime?.chatCompletionCacheTtlMs || 180000));
  const hardTimeoutMs = Math.max(15000, Number(config?.runtime?.chatHardTimeoutMs || 90000));
  const pendingStuckMs = Math.max(5000, Number(config?.runtime?.pendingChatStuckMs || 45000));

  function isoNow() {
    return new Date().toISOString();
  }

  function parseIsoMs(value) {
    const ts = Date.parse(String(value || ''));
    return Number.isFinite(ts) ? ts : null;
  }

  function ageMsFromIso(value) {
    const started = parseIsoMs(value);
    if (started == null) return null;
    return Math.max(0, Date.now() - started);
  }

  function summarizePendingEntry(entry) {
    const ageMs = ageMsFromIso(entry?.startedAt);
    const timeoutHeadroomMs = ageMs == null ? null : Math.max(0, hardTimeoutMs - ageMs);
    return {
      sessionId: String(entry?.sessionId || ''),
      turnId: String(entry?.turnId || ''),
      startedAt: entry?.startedAt || null,
      ageMs,
      hardTimeoutMs,
      timeoutHeadroomMs,
      stuck: ageMs != null ? ageMs >= pendingStuckMs : false,
      messagePreview: String(entry?.message || '').slice(0, 120),
      telemetry: entry?.telemetry || null
    };
  }

  function summarizeCompletedEntry(row) {
    const payload = row?.payload || {};
    return {
      sessionId: String(payload?.sessionId || ''),
      turnId: String(payload?.turnId || ''),
      completedAt: row?.completedAt || null,
      startedAt: payload?.startedAt || null,
      totalMs: Number(payload?.trace?.latency?.totalMs || 0) || null,
      timeout: Boolean(payload?._runtimeTimeout),
      telemetry: payload?.trace?.latency || null
    };
  }

  async function withTimeout(promise, timeoutMs, timeoutMessage = 'operation_timeout') {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function getOrStartChat(sessionId, message) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    const existing = pendingChats.get(sid);
    if (existing) return existing;
    const startedAt = isoNow();
    const turnId = crypto.randomUUID();
    const entry = {
      sessionId: sid,
      message,
      startedAt,
      turnId,
      promise: null,
      trace: null,
      interventions: [],
      telemetry: {
        queuedAt: startedAt,
        queueWaitMs: 0,
        providerMs: null,
        continuationMs: null,
        persistenceMs: null,
        totalMs: null,
        path: null
      }
    };
    const startedAtMs = Date.now();
    const agentPromise = agent.chat({ message, sessionId: sid });
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          sessionId: sid,
          reply: 'Request is taking too long. Partial progress may still arrive, but this turn hit the hard timeout.',
          model: agent.getCurrentModel?.() || null,
          trace: {
            note: 'chat_hard_timeout',
            timeoutMs: hardTimeoutMs
          },
          _runtimeTimeout: true
        });
      }, hardTimeoutMs);
    });
    entry.promise = Promise.race([agentPromise, timeoutPromise])
      .then((out) => {
        const completedAtMs = Date.now();
        if (out?._runtimeTimeout) {
          try {
            agent.memoryStore?.addMessage(sid, 'assistant', out.reply);
          } catch {}
        }
        saveConfig();
        // PHASE 3: Store trace in pending chat for retrieval
        entry.trace = out.trace || null;
        entry.interventions = out.trace?.interventions || [];
        entry.completedAt = isoNow();
        entry.telemetry = {
          queuedAt: entry.startedAt,
          queueWaitMs: 0,
          providerMs: Number(out?.trace?.latency?.providerMs || 0) || null,
          continuationMs: Number(out?.trace?.latency?.continuationMs || 0) || null,
          persistenceMs: Number(out?.trace?.latency?.persistenceMs || 0) || null,
          totalMs: Math.max(0, completedAtMs - startedAtMs),
          path: out?.trace?.latency?.path || null
        };
        completedChats.set(sid, {
          completedAt: entry.completedAt,
          payload: {
            ...out,
            turnId,
            startedAt: entry.startedAt,
            runtimeTelemetry: entry.telemetry
          }
        });
        return {
          ...out,
          turnId,
          startedAt: entry.startedAt
        };
      })
      .finally(() => {
        pendingChats.delete(sid);
      });
    pendingChats.set(sid, entry);
    return entry;
  }

  function prunePendingChats({ keepSessionId = '' } = {}) {
    const keep = String(keepSessionId || '').trim();
    let removed = 0;
    for (const sid of pendingChats.keys()) {
      if (keep && sid === keep) continue;
      pendingChats.delete(sid);
      removed += 1;
    }
    return removed;
  }

  function getCompletedChat(sessionId, { consume = false } = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    const row = completedChats.get(sid);
    if (!row) return null;
    const ageMs = Date.now() - Date.parse(row.completedAt || new Date(0).toISOString());
    if (!Number.isFinite(ageMs) || ageMs > completedTtlMs) {
      completedChats.delete(sid);
      return null;
    }
    if (consume) completedChats.delete(sid);
    return row.payload || null;
  }

  function getPendingDiagnostics({ includeCompleted = false, limit = 80 } = {}) {
    const max = Math.max(1, Math.min(200, Number(limit || 80)));
    const pending = [...pendingChats.values()].map((entry) => summarizePendingEntry(entry));
    const stuck = pending.filter((row) => row.stuck);
    const oldestAgeMs = pending.reduce((acc, row) => {
      const age = Number(row?.ageMs || 0);
      return age > acc ? age : acc;
    }, 0);
    const completed = includeCompleted
      ? [...completedChats.values()].map((row) => summarizeCompletedEntry(row)).slice(0, max)
      : [];
    return {
      ok: true,
      generatedAt: isoNow(),
      thresholds: {
        hardTimeoutMs,
        pendingStuckMs,
        completedTtlMs
      },
      pendingCount: pending.length,
      stuckCount: stuck.length,
      oldestAgeMs,
      pending: pending.sort((a, b) => Number(b.ageMs || 0) - Number(a.ageMs || 0)).slice(0, max),
      completed
    };
  }

  return {
    pendingChats,
    completedChats,
    hardTimeoutMs,
    pendingStuckMs,
    withTimeout,
    getOrStartChat,
    prunePendingChats,
    getCompletedChat,
    getPendingDiagnostics
  };
}
