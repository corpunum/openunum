export function buildClearAllSessionsPayload() {
  return { force: true, keepSessionId: '' };
}

export function buildSessionExportFilename(sessionId) {
  return `openunum-session-${String(sessionId || '').trim()}.json`;
}

export function buildSessionExportStatus(out = {}) {
  return `session export ready | messages=${Number(out.messages?.length || 0)} tokens=${Number(out.estimatedTokens || 0)}`;
}

export function buildSessionImportRequest(parsed = {}, randomSessionId = '') {
  return {
    sessionId: String(parsed.sessionId || randomSessionId || '').trim(),
    messages: Array.isArray(parsed.messages) ? parsed.messages : []
  };
}

export function buildSessionImportStatus(sessionId, out = {}) {
  return `session imported | ${sessionId} | messages=${Number(out.session?.messageCount || 0)}`;
}

export function buildMissionCloneStatus(sourceSessionId, targetSessionId) {
  return `mission session cloned | ${sourceSessionId} -> ${targetSessionId}`;
}
