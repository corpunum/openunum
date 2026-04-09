export function closeVaultModal(q, vaultModalState, modalId = 'vaultEditModal') {
  const modal = q(modalId);
  if (!modal) return;
  if (modal.open) modal.close();
  if (modalId === 'vaultEditModal' && vaultModalState) {
    vaultModalState.kind = '';
    vaultModalState.id = '';
  }
}
