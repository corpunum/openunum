export function createChatPendingController({
  jget,
  sleep,
  pendingPollDelayMs,
  createPendingTelemetry,
  markPendingTelemetryActivity,
  markPendingTelemetryCleared,
  markPendingTelemetryFinal,
  summarizePendingTelemetry,
  formatPendingTelemetrySummary,
  newestAssistantSince,
  buildPendingStatus,
  escapeHtml,
  appendTypingBubble,
  addLiveEvent,
  renderLiveBubble,
  refreshSessionList,
  loadSession,
  updateComposerPendingState,
  isLiveActivityEnabled,
  getSessionId,
  isRequestTokenCurrent,
  nextRequestToken,
  addPendingSession,
  removePendingSession
}) {
  async function resolvePendingReplyViaStream(typing, startedAtIso, requestSessionId, requestTurnId, requestToken, deadline) {
    if (typeof EventSource === 'undefined') return null;
    const url = `/api/chat/stream?sessionId=${encodeURIComponent(requestSessionId)}&since=${encodeURIComponent(startedAtIso)}&turnId=${encodeURIComponent(requestTurnId || '')}`;
    return await new Promise((resolve) => {
      let settled = false;
      const source = new EventSource(url);
      const cleanup = (result = null) => {
        if (settled) return;
        settled = true;
        try { source.close(); } catch {}
        clearTimeout(timeoutId);
        resolve(result);
      };
      const timeoutMs = Math.max(1000, deadline - Date.now());
      const timeoutId = setTimeout(() => cleanup(null), timeoutMs);

      source.onmessage = (ev) => {
        if (!isRequestTokenCurrent(requestToken)) {
          cleanup(false);
          return;
        }
        let payload = null;
        try {
          payload = JSON.parse(String(ev.data || '{}'));
        } catch {
          return;
        }
        typing.pollCount = (typing.pollCount || 0) + 1;
        markPendingTelemetryActivity(typing.pendingTelemetry);
        const tools = Array.isArray(payload?.toolRuns) ? payload.toolRuns : [];
        if ((typing.lastToolCount || 0) !== tools.length) {
          addLiveEvent(typing, `tool count ${typing.lastToolCount || 0} -> ${tools.length}`);
          typing.lastToolCount = tools.length;
        }
        const statusText = buildPendingStatus(typing, payload, {
          pending: Boolean(payload?.pending),
          startedAt: payload?.startedAt || startedAtIso
        });
        const msgFromActivity = newestAssistantSince(payload?.messages || [], startedAtIso);
        if (isLiveActivityEnabled()) {
          renderLiveBubble(typing, statusText, tools);
        } else {
          typing.bubble.textContent = statusText;
        }
        if (payload?.completed?.reply) {
          markPendingTelemetryFinal(typing.pendingTelemetry);
          const timingSummary = summarizePendingTelemetry(typing.pendingTelemetry);
          if (timingSummary) addLiveEvent(typing, formatPendingTelemetrySummary(timingSummary));
          addLiveEvent(typing, 'assistant final response received');
          typing.bubble.innerHTML = payload.completed.replyHtml || `<pre>${escapeHtml(payload.completed.reply)}</pre>`;
          void refreshSessionList();
          cleanup(true);
          return;
        }
        if (msgFromActivity?.content) {
          markPendingTelemetryFinal(typing.pendingTelemetry);
          const timingSummary = summarizePendingTelemetry(typing.pendingTelemetry);
          if (timingSummary) addLiveEvent(typing, formatPendingTelemetrySummary(timingSummary));
          addLiveEvent(typing, 'assistant final response received');
          typing.bubble.innerHTML = msgFromActivity.html || `<pre>${escapeHtml(msgFromActivity.content)}</pre>`;
          void refreshSessionList();
          cleanup(true);
          return;
        }
        if (!payload?.pending) {
          markPendingTelemetryCleared(typing.pendingTelemetry);
        }
        if (payload?.done === true) {
          cleanup(null);
        }
      };

      source.onerror = () => cleanup(null);
    });
  }

  async function resolvePendingReply(typing, startedAtIso, requestSessionId, requestToken, requestTurnId = '') {
    const deadline = Date.now() + 10 * 60 * 1000;
    typing.pendingTelemetry = createPendingTelemetry(startedAtIso);
    addPendingSession(requestSessionId);
    updateComposerPendingState();
    try {
      const streamResult = await resolvePendingReplyViaStream(
        typing,
        startedAtIso,
        requestSessionId,
        requestTurnId,
        requestToken,
        deadline
      );
      if (streamResult !== null) return streamResult;

      while (Date.now() < deadline) {
        if ((typing.pollCount || 0) > 0) {
          await sleep(pendingPollDelayMs(typing.pollCount || 0));
        }
        if (!isRequestTokenCurrent(requestToken)) return false;
        typing.pollCount = (typing.pollCount || 0) + 1;
        const act = await jget(`/api/sessions/${encodeURIComponent(requestSessionId)}/activity?since=${encodeURIComponent(startedAtIso)}`);
        markPendingTelemetryActivity(typing.pendingTelemetry);
        const tools = Array.isArray(act.toolRuns) ? act.toolRuns : [];
        if ((typing.lastToolCount || 0) !== tools.length) {
          addLiveEvent(typing, `tool count ${typing.lastToolCount || 0} -> ${tools.length}`);
          typing.lastToolCount = tools.length;
        }
        const pendingState = {
          pending: Boolean(act?.pending),
          startedAt: act?.pendingStartedAt || startedAtIso
        };
        const statusText = buildPendingStatus(typing, act, pendingState);
        const msgFromActivity = newestAssistantSince(act.messages || [], startedAtIso);
        if (isLiveActivityEnabled()) {
          renderLiveBubble(typing, statusText, tools);
        } else {
          typing.bubble.textContent = statusText;
        }
        if (msgFromActivity?.content) {
          markPendingTelemetryFinal(typing.pendingTelemetry);
          const timingSummary = summarizePendingTelemetry(typing.pendingTelemetry);
          if (timingSummary) addLiveEvent(typing, formatPendingTelemetrySummary(timingSummary));
          addLiveEvent(typing, 'assistant final response received');
          typing.bubble.innerHTML = msgFromActivity.html || `<pre>${escapeHtml(msgFromActivity.content)}</pre>`;
          await refreshSessionList();
          return true;
        }
        if (pendingState.pending) continue;
        markPendingTelemetryCleared(typing.pendingTelemetry);
        let msg = null;
        const pendingCheck = await jget(`/api/chat/pending?sessionId=${encodeURIComponent(requestSessionId)}`);
        if (pendingCheck?.completed && pendingCheck?.reply) {
          markPendingTelemetryFinal(typing.pendingTelemetry);
          const timingSummary = summarizePendingTelemetry(typing.pendingTelemetry);
          if (timingSummary) addLiveEvent(typing, formatPendingTelemetrySummary(timingSummary));
          addLiveEvent(typing, 'assistant final response received');
          typing.bubble.innerHTML = pendingCheck.replyHtml || `<pre>${escapeHtml(pendingCheck.reply)}</pre>`;
          await refreshSessionList();
          return true;
        }
        if (!msg) {
          const out = await jget(`/api/sessions/${encodeURIComponent(requestSessionId)}`);
          msg = newestAssistantSince(out.messages || [], startedAtIso);
        }
        if (msg?.content) {
          markPendingTelemetryFinal(typing.pendingTelemetry);
          const timingSummary = summarizePendingTelemetry(typing.pendingTelemetry);
          if (timingSummary) addLiveEvent(typing, formatPendingTelemetrySummary(timingSummary));
          addLiveEvent(typing, 'assistant final response received');
          typing.bubble.innerHTML = msg.html || `<pre>${escapeHtml(msg.content)}</pre>`;
          await refreshSessionList();
          return true;
        }
        addLiveEvent(typing, 'pending ended but no assistant message found yet; reloading session');
        await loadSession(requestSessionId);
        typing.bubble.textContent = 'Agent finished tool work. Waiting for final response persistence.';
        return false;
      }
      addLiveEvent(typing, 'pending deadline reached; run continues in background');
      typing.bubble.textContent = 'Agent is still running in background. You can keep chatting; history is preserved.';
      return false;
    } finally {
      removePendingSession(requestSessionId);
      updateComposerPendingState();
    }
  }

  async function resumePendingSessionIfNeeded(targetSessionId = getSessionId()) {
    const sid = String(targetSessionId || '').trim();
    if (!sid || sid !== getSessionId()) return false;
    const activity = await jget(`/api/sessions/${encodeURIComponent(sid)}/activity`);
    if (!activity?.pending || !activity?.pendingStartedAt) {
      removePendingSession(sid);
      updateComposerPendingState();
      return false;
    }
    addPendingSession(sid);
    updateComposerPendingState();
    const typing = appendTypingBubble();
    typing.persistScope = `pending:${sid}:${activity.pendingStartedAt}`;
    typing.liveEvents = [`[${new Date().toLocaleTimeString()}] recovered pending run after refresh`];
    typing.lastToolCount = Array.isArray(activity.toolRuns) ? activity.toolRuns.length : 0;
    renderLiveBubble(typing, buildPendingStatus(typing, activity, activity), activity.toolRuns || []);
    const requestToken = nextRequestToken();
    resolvePendingReply(typing, activity.pendingStartedAt, sid, requestToken, activity.turnId || '').catch((error) => {
      typing.bubble.textContent = `Pending recovery failed: ${String(error?.message || error)}`;
    });
    return true;
  }

  return {
    resolvePendingReply,
    resumePendingSessionIfNeeded
  };
}
