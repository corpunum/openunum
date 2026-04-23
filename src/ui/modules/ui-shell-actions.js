export function createUiShellActions({
  q,
  qa,
  localStorage,
  setStatus,
  showView,
  closeVaultModal,
  saveVaultModal,
  testVaultModal,
  getAutoEscalateEnabled,
  setAutoEscalateEnabled,
  getLiveActivityEnabled,
  setLiveActivityEnabled
}) {
  function bindUiShellActions() {
    qa('.menu-btn').forEach((btn) => {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    });

    q('vaultEditCloseTop').onclick = () => closeVaultModal();
    q('vaultEditClose').onclick = () => closeVaultModal();

    q('vaultEditSave').onclick = () => saveVaultModal().catch((err) => {
      setStatus('providerStatus', `vault save failed: ${String(err.message || err)}`, { type: 'error', title: 'Vault' });
    });

    q('vaultEditTest').onclick = () => testVaultModal().catch((err) => {
      setStatus('providerStatus', `vault test failed: ${String(err.message || err)}`, { type: 'error', title: 'Vault' });
    });

    q('vaultEditModal').addEventListener('cancel', (event) => {
      event.preventDefault();
      closeVaultModal();
    });

    qa('.quick-prompt').forEach((btn) => {
      btn.addEventListener('click', () => {
        q('message').value = btn.dataset.prompt || '';
        q('message').focus();
      });
    });

    q('autoEscalateToggle').onclick = () => {
      const next = !getAutoEscalateEnabled();
      setAutoEscalateEnabled(next);
      localStorage.setItem('openunum_auto_escalate', String(next));
      q('autoEscalateToggle').textContent = `Auto: ${next ? 'On' : 'Off'}`;
    };

    q('liveActivityToggle').onclick = () => {
      const next = !getLiveActivityEnabled();
      setLiveActivityEnabled(next);
      localStorage.setItem('openunum_live_activity', String(next));
      q('liveActivityToggle').textContent = `Live: ${next ? 'On' : 'Off'}`;
    };
  }

  return {
    bindUiShellActions
  };
}
