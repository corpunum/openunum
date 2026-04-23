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
  detailPanelKey,
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
  function handleTypedEvent(typing, eventType, data) {
    if (!typing || !typing.bubble) return;
    switch (eventType) {
      case 'content_delta':
        if (data.token && typeof typing.appendTokenToBubble === 'function') {
          typing.appendTokenToBubble(data.token);
        }
        break;
      case 'reasoning_start':
        addLiveEvent(typing, 'Reasoning started');
        break;
      case 'reasoning_delta':
        if (data.token && typeof typing.appendReasoningToken === 'function') {
          typing.appendReasoningToken(data.token);
        }
        break;
      case 'reasoning_end':
        addLiveEvent(typing, 'Reasoning complete');
        break;
      case 'tool_call_started':
        addLiveEvent(typing, `Tool started: ${data.tool}`);
        if (typeof typing.addToolCallEvent === 'function') {
          typing.addToolCallEvent({ type: 'started', tool: data.tool, args: data.args, step: data.step });
        }
        break;
      case 'tool_call_completed':
        addLiveEvent(typing, `Tool completed: ${data.tool}`);
        if (typeof typing.addToolCallEvent === 'function') {
          typing.addToolCallEvent({ type: 'completed', tool: data.tool, resultOk: data.resultOk, step: data.step });
        }
        break;
      case 'tool_call_failed':
        addLiveEvent(typing, `Tool failed: ${data.tool} (${data.error || 'unknown'})`);
        if (typeof typing.addToolCallEvent === 'function') {
          typing.addToolCallEvent({ type: 'failed', tool: data.tool, error: data.error, step: data.step });
        }
        break;
      case 'turn_end':
        // Will be handled by the final snapshot
        break;
    }
  }

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

        // Only render live bubble if we haven't started streaming tokens or reasoning yet
        const hasStreamContent = (typing.streamingTokens || '').length > 0 || (typing.streamingReasoning || '').length > 0;
        if (isLiveActivityEnabled() && !hasStreamContent) {
          renderLiveBubble(typing, statusText, tools);
        }

        if (payload?.completed?.reply) {
          markPendingTelemetryFinal(typing.pendingTelemetry);
          const timingSummary = summarizePendingTelemetry(typing.pendingTelemetry);
          if (timingSummary) addLiveEvent(typing, formatPendingTelemetrySummary(timingSummary));
          addLiveEvent(typing, 'assistant final response received');
          const effectiveReasoningHtml = payload.completed.reasoningHtml
            || (typing.streamingReasoning ? escapeHtml(typing.streamingReasoning) : null);
          const reasoningSection = effectiveReasoningHtml ? `<details class="reasoning" data-persist-key="${escapeHtml(detailPanelKey(typing.persistScope || requestSessionId || 'pending', 'reasoning'))}"><summary>Thinking</summary><div class="reasoning-content">${effectiveReasoningHtml}</div></details>` : '';
          const rawModelOutput = payload.completed.rawReply || typing.streamingTokens || payload.completed.reply || '';
          const rawSection = rawModelOutput ? `<details class="raw-response" data-persist-key="${escapeHtml(detailPanelKey(typing.persistScope || requestSessionId || 'pending', 'raw-response'))}"><summary>Raw Response</summary><div class="raw-response-content">${escapeHtml(rawModelOutput)}</div></details>` : '';
          const renderedReply = payload.completed.replyHtml || `<pre>${escapeHtml(payload.completed.reply)}</pre>`;
          typing.bubble.innerHTML = reasoningSection + rawSection + renderedReply;
          void refreshSessionList();
          cleanup(true);
          return;
        }
        if (msgFromActivity?.content) {
          markPendingTelemetryFinal(typing.pendingTelemetry);
          const timingSummary = summarizePendingTelemetry(typing.pendingTelemetry);
          if (timingSummary) addLiveEvent(typing, formatPendingTelemetrySummary(timingSummary));
          addLiveEvent(typing, 'assistant final response received');
          const effectiveReasoningHtml2 = (typing.streamingReasoning ? escapeHtml(typing.streamingReasoning) : null);
          const reasoningSection = effectiveReasoningHtml2 ? `<details class="reasoning" data-persist-key="${escapeHtml(detailPanelKey(typing.persistScope || requestSessionId || 'pending', 'reasoning'))}"><summary>Thinking</summary><div class="reasoning-content">${effectiveReasoningHtml2}</div></details>` : '';
          const rawModelOutput2 = typing.streamingTokens || msgFromActivity.content || '';
          const rawSection = rawModelOutput2 ? `<details class="raw-response" data-persist-key="${escapeHtml(detailPanelKey(typing.persistScope || requestSessionId || 'pending', 'raw-response'))}"><summary>Raw Response</summary><div class="raw-response-content">${escapeHtml(rawModelOutput2)}</div></details>` : '';
          typing.bubble.innerHTML = reasoningSection + rawSection + (msgFromActivity.html || `<pre>${escapeHtml(msgFromActivity.content)}</pre>`);
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

      // Handle typed SSE events (content_delta, reasoning_delta, etc.)
      source.addEventListener('content_delta', (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (!isRequestTokenCurrent(requestToken)) return;
        handleTypedEvent(typing, 'content_delta', data);
      });
      source.addEventListener('reasoning_start', (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (!isRequestTokenCurrent(requestToken)) return;
        handleTypedEvent(typing, 'reasoning_start', data);
      });
      source.addEventListener('reasoning_delta', (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (!isRequestTokenCurrent(requestToken)) return;
        handleTypedEvent(typing, 'reasoning_delta', data);
      });
      source.addEventListener('reasoning_end', (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (!isRequestTokenCurrent(requestToken)) return;
        handleTypedEvent(typing, 'reasoning_end', data);
      });
      source.addEventListener('tool_call_started', (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (!isRequestTokenCurrent(requestToken)) return;
        handleTypedEvent(typing, 'tool_call_started', data);
      });
      source.addEventListener('tool_call_completed', (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (!isRequestTokenCurrent(requestToken)) return;
        handleTypedEvent(typing, 'tool_call_completed', data);
      });
      source.addEventListener('tool_call_failed', (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (!isRequestTokenCurrent(requestToken)) return;
        handleTypedEvent(typing, 'tool_call_failed', data);
      });
      source.addEventListener('turn_end', (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (!isRequestTokenCurrent(requestToken)) return;
        handleTypedEvent(typing, 'turn_end', data);
      });

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
        const hasStreamContent = (typing.streamingTokens || '').length > 0 || (typing.streamingReasoning || '').length > 0;
        if (isLiveActivityEnabled() && !hasStreamContent) {
          renderLiveBubble(typing, statusText, tools);
        } else if (!hasStreamContent) {
          typing.bubble.textContent = statusText;
        }
        if (msgFromActivity?.content) {
          markPendingTelemetryFinal(typing.pendingTelemetry);
          const timingSummary = summarizePendingTelemetry(typing.pendingTelemetry);
          if (timingSummary) addLiveEvent(typing, formatPendingTelemetrySummary(timingSummary));
          addLiveEvent(typing, 'assistant final response received');
          const effectiveReasoningHtml3 = (typing.streamingReasoning ? escapeHtml(typing.streamingReasoning) : null);
          const reasoningSection3 = effectiveReasoningHtml3 ? `<details class="reasoning" data-persist-key="${escapeHtml(detailPanelKey(typing.persistScope || requestSessionId || 'pending', 'reasoning'))}"><summary>Thinking</summary><div class="reasoning-content">${effectiveReasoningHtml3}</div></details>` : '';
          const rawModelOutput3 = typing.streamingTokens || msgFromActivity.content || '';
          const rawSection3 = rawModelOutput3 ? `<details class="raw-response" data-persist-key="${escapeHtml(detailPanelKey(typing.persistScope || requestSessionId || 'pending', 'raw-response'))}"><summary>Raw Response</summary><div class="raw-response-content">${escapeHtml(rawModelOutput3)}</div></details>` : '';
          typing.bubble.innerHTML = reasoningSection3 + rawSection3 + (msgFromActivity.html || `<pre>${escapeHtml(msgFromActivity.content)}</pre>`);
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
          const effectiveReasoningHtml4 = pendingCheck.reasoningHtml || (typing.streamingReasoning ? escapeHtml(typing.streamingReasoning) : null);
          const reasoningSection4 = effectiveReasoningHtml4 ? `<details class="reasoning" data-persist-key="${escapeHtml(detailPanelKey(typing.persistScope || requestSessionId || 'pending', 'reasoning'))}"><summary>Thinking</summary><div class="reasoning-content">${effectiveReasoningHtml4}</div></details>` : '';
          const rawModelOutput4 = pendingCheck.rawReply || typing.streamingTokens || pendingCheck.reply || '';
          const rawSection4 = rawModelOutput4 ? `<details class="raw-response" data-persist-key="${escapeHtml(detailPanelKey(typing.persistScope || requestSessionId || 'pending', 'raw-response'))}"><summary>Raw Response</summary><div class="raw-response-content">${escapeHtml(rawModelOutput4)}</div></details>` : '';
          typing.bubble.innerHTML = reasoningSection4 + rawSection4 + (pendingCheck.replyHtml || `<pre>${escapeHtml(pendingCheck.reply)}</pre>`);
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
          const effectiveReasoningHtml5 = (typing.streamingReasoning ? escapeHtml(typing.streamingReasoning) : null);
          const reasoningSection5 = effectiveReasoningHtml5 ? `<details class="reasoning" data-persist-key="${escapeHtml(detailPanelKey(typing.persistScope || requestSessionId || 'pending', 'reasoning'))}"><summary>Thinking</summary><div class="reasoning-content">${effectiveReasoningHtml5}</div></details>` : '';
          const rawModelOutput5 = typing.streamingTokens || msg.content || '';
          const rawSection5 = rawModelOutput5 ? `<details class="raw-response" data-persist-key="${escapeHtml(detailPanelKey(typing.persistScope || requestSessionId || 'pending', 'raw-response'))}"><summary>Raw Response</summary><div class="raw-response-content">${escapeHtml(rawModelOutput5)}</div></details>` : '';
          typing.bubble.innerHTML = reasoningSection5 + rawSection5 + (msg.html || `<pre>${escapeHtml(msg.content)}</pre>`);
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
