export function createChatComposerController({
  q,
  localStorage,
  topStatus,
  jpost,
  pushMsg,
  appendTypingBubble,
  renderTrace,
  formatProviderModel,
  chatFastAckTimeoutMs,
  isStatusCheckMessage,
  shouldEscalateToAuto,
  isPlanningReply,
  escapeHtml,
  isCurrentSessionPending,
  updateComposerPendingState,
  getSessionId,
  getSessionCache,
  getAutoEscalateEnabled,
  getLastTaskPrompt,
  setLastTaskPrompt,
  getNextRequestToken,
  addPendingSession,
  removePendingSession,
  resolvePendingReply,
  runAutoMissionFromChat,
  refreshSessionList,
  refreshTacticalLedger
}) {
  async function handleSend() {
    if (isCurrentSessionPending()) return;
    const message = q('message').value.trim();
    if (!message) return;

    if (!isStatusCheckMessage(message) && !/^\/\w+/.test(message)) {
      setLastTaskPrompt(message);
      localStorage.setItem('openunum_last_task_prompt', message);
    }

    const requestSessionId = getSessionId();
    const requestToken = getNextRequestToken();
    addPendingSession(requestSessionId);
    updateComposerPendingState();
    q('message').value = '';
    pushMsg('user', message);

    const typing = appendTypingBubble();
    const startedAtIso = new Date().toISOString();
    typing.persistScope = `pending:${requestSessionId}:${startedAtIso}`;

    const recentUserTurns = getSessionCache().find((s) => s.sessionId === requestSessionId)?.messageCount || 0;
    const fastAckTimeoutMs = chatFastAckTimeoutMs(message, { recentUserTurns });

    try {
      if (/^\/auto\b/i.test(message)) {
        await runAutoMissionFromChat(message, typing);
        return;
      }

      const out = await jpost('/api/chat', { sessionId: requestSessionId, message }, { timeoutMs: fastAckTimeoutMs });
      if (out?.pending) {
        await resolvePendingReply(typing, out.startedAt || startedAtIso, requestSessionId, requestToken, out.turnId || '');
        return;
      }

      if (shouldEscalateToAuto(message, out, getAutoEscalateEnabled())) {
        typing.bubble.textContent = 'Planning detected. Auto mission engaged...';
        await runAutoMissionFromChat(`/auto ${message}`, typing);
        return;
      }

      if (isStatusCheckMessage(message) && isPlanningReply(out) && getLastTaskPrompt()) {
        typing.bubble.textContent = 'Status check detected while planning continues. Resuming autonomous mission...';
        await runAutoMissionFromChat(`/auto ${getLastTaskPrompt()}`, typing);
        return;
      }

      const traceHtml = renderTrace(out?.trace);
      const reasoningHtml = out?.reasoningHtml ? `<details class="reasoning" data-persist-key="reasoning"><summary>Thinking</summary><div class="reasoning-content">${out.reasoningHtml}</div></details>` : '';
      const rawModelOutput = out?.rawReply || out?.reply || '';
      const rawSection = rawModelOutput ? `<details class="raw-response" data-persist-key="raw-response"><summary>Raw Response</summary><div class="raw-response-content">${escapeHtml(rawModelOutput)}</div></details>` : '';
      const assistantHtml = `${reasoningHtml}${rawSection}${out?.replyHtml || out?.reply || '(no reply)'}${traceHtml}`;
      typing.bubble.innerHTML = assistantHtml;
      void typing.bubble.offsetHeight;

      if (out?.model?.provider && out?.model?.model && out?.model?.activeProvider && out?.model?.activeModel) {
        topStatus.textContent = `cfg=${formatProviderModel(out.model.provider, out.model.model)} active=${formatProviderModel(out.model.activeProvider, out.model.activeModel)}`;
      }
      await refreshSessionList();
      await refreshTacticalLedger();
    } catch (error) {
      const msg = String(error.message || error);
      if (msg.includes('request_timeout')) {
        typing.bubble.textContent = 'Request is still running. Switching to live pending view...';
        await resolvePendingReply(typing, startedAtIso, requestSessionId, requestToken, '');
      } else {
        typing.bubble.textContent = `request failed: ${msg}`;
      }
    } finally {
      removePendingSession(requestSessionId);
      updateComposerPendingState();
    }
  }

  function bindComposerActions() {
    q('send').onclick = handleSend;
    q('message').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        q('send').click();
      }
    });
  }

  return {
    handleSend,
    bindComposerActions
  };
}
