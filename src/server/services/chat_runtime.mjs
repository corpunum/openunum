export function createChatRuntimeService({ agent, saveConfig, config }) {
  const pendingChats = new Map();
  const completedChats = new Map();
  const completedTtlMs = Math.max(5000, Number(config?.runtime?.chatCompletionCacheTtlMs || 180000));
  const hardTimeoutMs = Math.max(15000, Number(config?.runtime?.chatHardTimeoutMs || 90000));

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
    const startedAt = new Date().toISOString();
    const entry = { sessionId: sid, message, startedAt, promise: null, trace: null, interventions: [] };
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
        if (out?._runtimeTimeout) {
          try {
            agent.memoryStore?.addMessage(sid, 'assistant', out.reply);
          } catch {}
        }
        saveConfig();
        // PHASE 3: Store trace in pending chat for retrieval
        entry.trace = out.trace || null;
        entry.interventions = out.trace?.interventions || [];
        entry.completedAt = new Date().toISOString();
        completedChats.set(sid, {
          completedAt: entry.completedAt,
          payload: out
        });
        return out;
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

  return {
    pendingChats,
    completedChats,
    withTimeout,
    getOrStartChat,
    prunePendingChats,
    getCompletedChat
  };
}
