export function bindSettingsRuntimeSessionActions(ctx) {
  const {
    q,
    localStorage,
    jget,
    jpost,
    setStatus,
    buildClearAllSessionsPayload,
    buildSessionExportFilename,
    buildSessionExportStatus,
    buildSessionImportRequest,
    buildSessionImportStatus,
    refreshRuntime,
    refreshModel,
    refreshRuntimeOverview,
    refreshAutonomyDashboard,
    refreshContextStatus,
    refreshTacticalLedger,
    refreshPhase0Diagnostics,
    refreshSessionList,
    loadSession,
    resetSession,
    showView,
    getSessionId,
    setSessionId
  } = ctx;

  q('compactContextBtn').onclick = async () => {
    const out = await jpost('/api/context/compact', { sessionId: getSessionId(), dryRun: false });
    setStatus(
      'runtimeStatus',
      out.skipped
        ? `compact skipped: ${out.reason}`
        : `compacted pre=${Number(out.preTokens || 0)} post=${Number(out.postTokens || 0)} artifacts=${Number(out.artifactsCount || 0)}`,
      { type: out.skipped ? 'warn' : 'success', title: 'Context' }
    );
    await refreshContextStatus();
    await loadSession();
    await refreshSessionList();
    await refreshTacticalLedger();
  };

  q('refreshLedgerBtn').onclick = refreshTacticalLedger;
  q('refreshPhase0Diag').onclick = refreshPhase0Diagnostics;

  q('applyAutonomyMode').onclick = async () => {
    const out = await jpost('/api/autonomy/mode', { mode: q('autonomyMode').value });
    setStatus(
      'runtimeStatus',
      `applied mode=${out.mode} shell=${out.runtime?.shellEnabled} maxIters=${out.runtime?.maxToolIterations}`,
      { type: 'success', title: 'Runtime' }
    );
    await refreshRuntime();
    await refreshModel();
    await refreshRuntimeOverview();
    if (refreshAutonomyDashboard) await refreshAutonomyDashboard();
  };

  q('newChat').onclick = async () => {
    await resetSession();
    await refreshContextStatus();
  };

  q('newChatInMenu').onclick = async () => {
    await resetSession();
    await refreshContextStatus();
  };

  q('deleteAllSessions').onclick = async () => {
    const confirmed = confirm('Delete all sessions? This action cannot be undone.');
    if (!confirmed) return;
    await jpost('/api/sessions/clear', buildClearAllSessionsPayload());
    await resetSession();
    await refreshContextStatus();
    await refreshTacticalLedger();
  };

  q('exportSessionBtn').onclick = async () => {
    const out = await jget(`/api/sessions/${encodeURIComponent(getSessionId())}/export`);
    q('pcOutput').value = JSON.stringify(out, null, 2);
    showView('operator');
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = buildSessionExportFilename(getSessionId());
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    setStatus('runtimeStatus', buildSessionExportStatus(out), { type: 'success', title: 'Session Export' });
    await refreshTacticalLedger();
  };

  q('importSessionBtn').onclick = () => q('importSessionFile').click();
  q('importSessionFile').onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text);
    const out = await jpost('/api/sessions/import', buildSessionImportRequest(parsed, crypto.randomUUID()));
    setSessionId(out.session.sessionId);
    localStorage.setItem('openunum_session', out.session.sessionId);
    q('chatMeta').textContent = out.session.sessionId;
    await loadSession();
    await refreshSessionList();
    await refreshContextStatus();
    await refreshTacticalLedger();
    setStatus('runtimeStatus', buildSessionImportStatus(out.session.sessionId, out), { type: 'success', title: 'Session Import' });
    showView('chat');
    q('importSessionFile').value = '';
  };
}

