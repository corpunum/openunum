import { createShowView } from './navigation.js';

export function createUiStateHelpers({
  q,
  localStorage,
  pendingSessions,
  getSessionId,
  getDetailPanelState,
  rememberDetailPanelStateWithStorage,
  showViewWithMeta,
  viewMeta
}) {
  function isCurrentSessionPending() {
    return pendingSessions.has(getSessionId());
  }

  function updateComposerPendingState() {
    const pending = isCurrentSessionPending();
    q('send').disabled = pending;
    q('message').placeholder = pending
      ? 'Session is still running. Switch sessions or wait for completion.'
      : 'Type a message. Enter sends, Shift+Enter adds a new line';
  }

  function rememberDetailPanelState(key, patch) {
    rememberDetailPanelStateWithStorage(getDetailPanelState(), key, patch, localStorage);
  }

  const originalShowView = (viewId) => showViewWithMeta(viewId, viewMeta);
  const showView = createShowView(originalShowView);

  return {
    isCurrentSessionPending,
    updateComposerPendingState,
    rememberDetailPanelState,
    showView
  };
}