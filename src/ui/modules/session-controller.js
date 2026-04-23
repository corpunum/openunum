import { sortSessionsByRecency, renderSessionListView } from './sessions.js';

export function createSessionController({
  q,
  jget,
  jpost,
  jrequest,
  escapeHtml,
  formatRelativeTime,
  localStorage,
  chat,
  sessionListEl,
  showView,
  updateComposerPendingState,
  refreshContextStatus,
  refreshTacticalLedger,
  pushMsg,
  getSessionId,
  setSessionId,
  getSessionLoadToken,
  setSessionLoadToken,
  resumePendingSessionIfNeeded,
  renderImageAttachments,
  refreshGallery
}) {
  let sessionCache = [];

  function getSessionCache() {
    return sessionCache;
  }

  function renderSessionList({ refreshSessionList, switchToSession, resetSession }) {
    const query = String(q('sessionSearch')?.value || '').trim();
    renderSessionListView({
      sessionListEl,
      sessionCache,
      query,
      sessionId: getSessionId(),
      escapeHtml,
      formatRelativeTime,
      onSwitch: async (sid) => switchToSession(sid),
      onDelete: async (event, s) => {
        event.preventDefault();
        event.stopPropagation();
        const confirmed = confirm(`Delete session ${s.sessionId}?`);
        if (!confirmed) return;
        await jrequest('DELETE', `/api/sessions/${encodeURIComponent(s.sessionId)}`);
        if (s.sessionId === getSessionId()) {
          await resetSession();
          await refreshContextStatus();
          await refreshTacticalLedger();
        } else {
          await refreshSessionList();
        }
      }
    });
  }

  async function refreshSessionList() {
    const out = await jget('/api/sessions?limit=120');
    sessionCache = sortSessionsByRecency(out.sessions || []);
    renderSessionList({ refreshSessionList, switchToSession, resetSession });
  }

  async function ensureSessionExists(id) {
    await jpost('/api/sessions', { sessionId: id });
  }

  async function switchToSession(nextSessionId) {
    const target = String(nextSessionId || '').trim();
    if (!target) return;
    setSessionId(target);
    localStorage.setItem('openunum_session', getSessionId());
    q('chatMeta').textContent = getSessionId();
    updateComposerPendingState();
    await ensureSessionExists(getSessionId());
    await loadSession(getSessionId());
    await refreshContextStatus().catch(() => {});
    await refreshTacticalLedger().catch(() => {});
    renderSessionList({ refreshSessionList, switchToSession, resetSession });
    showView('chat');
  }

  async function loadSession(targetSessionId = getSessionId()) {
    const sid = String(targetSessionId || '').trim();
    const token = getSessionLoadToken() + 1;
    setSessionLoadToken(token);
    chat.innerHTML = '<div class="hint">Loading session...</div>';
    const out = await jget(`/api/sessions/${encodeURIComponent(sid)}`);
    if (token !== getSessionLoadToken() || sid !== getSessionId()) return;
    chat.innerHTML = '';
    for (const m of out.messages || []) {
      if (m.role === 'assistant') {
        const reasoningHtml = m.reasoningHtml ? `<details class="reasoning" data-persist-key="reasoning"><summary>Thinking</summary><div class="reasoning-content">${m.reasoningHtml}</div></details>` : '';
        const rawSection = m.rawReply ? `<details class="raw-response" data-persist-key="raw-response"><summary>Raw Response</summary><div class="raw-response-content">${escapeHtml(m.rawReply)}</div></details>` : '';
        const combinedHtml = reasoningHtml + rawSection + (m.html || `<pre>${escapeHtml(m.content)}</pre>`) + renderImageAttachments(m.imageFiles);
        pushMsg('assistant', m.content, combinedHtml);
      } else {
        pushMsg(m.role, m.content, '');
      }
    }
    await resumePendingSessionIfNeeded(sid);
    if (typeof refreshGallery === 'function') refreshGallery();
  }

  async function resetSession() {
    setSessionId(crypto.randomUUID());
    localStorage.setItem('openunum_session', getSessionId());
    q('chatMeta').textContent = getSessionId();
    chat.innerHTML = '';
    updateComposerPendingState();
    await ensureSessionExists(getSessionId());
    await refreshSessionList();
  }

  function bindSessionSearch() {
    q('sessionSearch').addEventListener('input', () =>
      renderSessionList({ refreshSessionList, switchToSession, resetSession })
    );
  }

  return {
    getSessionCache,
    renderSessionList: () => renderSessionList({ refreshSessionList, switchToSession, resetSession }),
    refreshSessionList,
    ensureSessionExists,
    switchToSession,
    loadSession,
    resetSession,
    bindSessionSearch
  };
}
