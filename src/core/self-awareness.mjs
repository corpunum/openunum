function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function normalizeText(text = '') {
  return String(text || '').trim();
}

function isRecoveryStyleReply(text = '') {
  const raw = normalizeText(text);
  if (!raw) return false;
  return /^Status:\s+\w+/i.test(raw) && /Findings:/i.test(raw);
}

function isGenericAckReply(text = '') {
  return /^Ready\.\s+Tell me what you want to do next\./i.test(normalizeText(text));
}

function collectSessionIds(memoryStore, limit) {
  if (!memoryStore?.listSessions) return [];
  const out = memoryStore.listSessions(limit);
  if (!Array.isArray(out)) return [];
  return out
    .map((item) => String(item?.sessionId || '').trim())
    .filter(Boolean);
}

function collectAssistantReplies(memoryStore, sessionId, perSessionLimit) {
  if (!memoryStore?.getMessagesForContext) return [];
  const history = memoryStore.getMessagesForContext(sessionId, perSessionLimit) || [];
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item?.role === 'assistant')
    .map((item) => normalizeText(item?.content || ''))
    .filter(Boolean);
}

export function buildSelfAwarenessSnapshot({
  memoryStore,
  sessionScanLimit = 12,
  perSessionMessageLimit = 40
} = {}) {
  const sessionIds = collectSessionIds(memoryStore, sessionScanLimit);
  const assistantReplies = [];
  for (const sessionId of sessionIds) {
    assistantReplies.push(...collectAssistantReplies(memoryStore, sessionId, perSessionMessageLimit));
  }

  const recoveryStyleCount = assistantReplies.filter((text) => isRecoveryStyleReply(text)).length;
  const genericAckCount = assistantReplies.filter((text) => isGenericAckReply(text)).length;
  const assistantTurnCount = assistantReplies.length;

  const recoveryRate = assistantTurnCount > 0 ? recoveryStyleCount / assistantTurnCount : 0;
  const genericAckRate = assistantTurnCount > 0 ? genericAckCount / assistantTurnCount : 0;
  const coverage = clamp(sessionIds.length / Math.max(1, Number(sessionScanLimit || 12)), 0, 1);
  const hasEvidence = assistantTurnCount > 0;
  const score = hasEvidence
    ? clamp(
      100 - (recoveryRate * 75) - (genericAckRate * 55) + (coverage * 8),
      0,
      100
    )
    : 0;

  const issues = [];
  if (recoveryStyleCount > 0) {
    issues.push(`Recovery-format replies detected (${recoveryStyleCount}).`);
  }
  if (genericAckCount > 0) {
    issues.push(`Generic acknowledgement replies detected (${genericAckCount}).`);
  }
  if (sessionIds.length === 0) {
    issues.push('No session evidence available for self-awareness scoring.');
  }

  return {
    score: Number(score.toFixed(1)),
    status: !hasEvidence ? 'insufficient_evidence' : score >= 85 ? 'healthy' : (score >= 70 ? 'watch' : 'degraded'),
    sampledAt: new Date().toISOString(),
    sessionsScanned: sessionIds.length,
    assistantTurnsScanned: assistantTurnCount,
    metrics: {
      recoveryStyleCount,
      genericAckCount,
      recoveryRate: Number(recoveryRate.toFixed(3)),
      genericAckRate: Number(genericAckRate.toFixed(3))
    },
    issues
  };
}
