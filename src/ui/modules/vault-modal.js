export function closeVaultModal(q, vaultModalState) {
  const modal = q('vaultEditModal');
  if (!modal) return;
  if (modal.open) modal.close();
  vaultModalState.kind = '';
  vaultModalState.id = '';
}
