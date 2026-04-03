export function createChatRuntimeService({ agent, saveConfig }) {
  const pendingChats = new Map();

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
    const promise = agent.chat({ message, sessionId: sid })
      .then((out) => {
        saveConfig();
        return out;
      })
      .finally(() => {
        pendingChats.delete(sid);
      });
    const entry = { sessionId: sid, message, startedAt, promise };
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

  return {
    pendingChats,
    withTimeout,
    getOrStartChat,
    prunePendingChats
  };
}

