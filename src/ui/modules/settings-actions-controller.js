export function createSettingsActionsController({
  q,
  localStorage,
  jget,
  jpost,
  runWebuiWireValidation,
  setStatus,
  topStatus,
  formatProviderModel,
  buildProviderModelsPatch,
  computeOnlineFallbackSequence,
  canAddFallbackProvider,
  autoFillFallbackSequence,
  buildClearAllSessionsPayload,
  buildSessionExportFilename,
  buildSessionExportStatus,
  buildSessionImportRequest,
  buildSessionImportStatus,
  getModelProviderIds,
  getModelCatalog,
  getFallbackSequence,
  setFallbackSequence,
  preferredModelForProvider,
  ensureFallbackSequence,
  normalizeHiddenRows,
  refreshAddRowSelectors,
  renderProviderMatrix,
  renderAuthMethodTable,
  refreshRuntime,
  refreshModel,
  refreshModelCatalog,
  refreshProviderConfig,
  refreshRuntimeOverview,
  refreshContextStatus,
  refreshTacticalLedger,
  refreshPhase0Diagnostics,
  refreshSessionList,
  loadSession,
  resetSession,
  loadModelsForProvider,
  renderFallbackSequence,
  showView,
  getSessionId,
  setSessionId,
  getHiddenProviderRows,
  setHiddenProviderRows,
  getHiddenServiceRows,
  setHiddenServiceRows,
  getAuthCatalog
}) {
  function bindSettingsActions() {
    q('provider').onchange = async () => {
      await loadModelsForProvider(q('provider').value);
    };

    q('loadModels').onclick = async () => {
      await loadModelsForProvider(q('provider').value);
    };

    q('switchModel').onclick = async () => {
      const model = q('modelList').value;
      if (!model) return;
      const out = await jpost('/api/model/switch', { provider: q('provider').value, model });
      topStatus.textContent = `cfg=${formatProviderModel(out.provider, out.model)} active=${formatProviderModel(out.activeProvider, out.activeModel)}`;
      setStatus('modelCatalogStatus', `model switched to ${formatProviderModel(out.provider, out.model)}`, {
        type: 'success',
        title: 'Model Routing'
      });
      await refreshModelCatalog();
      await refreshRuntimeOverview();
    };

    q('saveRouting').onclick = async () => {
      const enabled = q('fallbackEnabled').value === 'true';
      const provider = q('provider').value;
      const selectedModel = q('modelList').value;
      ensureFallbackSequence(provider);
      const onlineFallbackSequence = computeOnlineFallbackSequence(getFallbackSequence(), getModelCatalog());
      const providerModels = buildProviderModelsPatch(provider, selectedModel, onlineFallbackSequence);
      await jpost('/api/config', {
        model: {
          provider,
          ...(selectedModel ? { model: selectedModel } : {}),
          providerModels,
          routing: {
            fallbackEnabled: enabled,
            fallbackProviders: onlineFallbackSequence.map((entry) => entry.provider)
          }
        },
        runtime: {
          shellEnabled: q('shellEnabled').value === 'true',
          maxToolIterations: Number(q('maxIters').value || 8)
        }
      });
      setStatus(
        'modelCatalogStatus',
        `routing saved | primary=${formatProviderModel(provider, selectedModel || '')} | fallbacks=${onlineFallbackSequence.map((entry) => entry.provider).join(' -> ') || 'none'}`,
        { type: 'success', title: 'Model Routing' }
      );
      await refreshModel();
      await refreshRuntimeOverview();
      await runWebuiWireValidation('routing_save');
    };

    q('prefillLocalAuth').onclick = async () => {
      const out = await jpost('/api/auth/prefill-local', { overwriteBaseUrls: false });
      setStatus(
        'providerStatus',
        `local auth scan saved | files=${Number(out.scannedFiles?.length || 0)} | github=${Boolean(out.imported?.githubToken)}`,
        { type: 'success', title: 'Provider Vault' }
      );
      await refreshProviderConfig();
      await refreshModelCatalog();
      await refreshRuntimeOverview();
      await runWebuiWireValidation('prefill_local_auth');
    };

    q('refreshAuthCatalog').onclick = async () => {
      await refreshProviderConfig();
      await refreshModelCatalog();
      await refreshRuntimeOverview();
      await runWebuiWireValidation('refresh_auth_catalog');
    };

    q('showAllProviderRows').onclick = () => {
      setHiddenProviderRows([]);
      normalizeHiddenRows();
      refreshAddRowSelectors();
      renderProviderMatrix(getAuthCatalog()?.providers || []);
    };

    q('showAllServiceRows').onclick = () => {
      setHiddenServiceRows([]);
      normalizeHiddenRows();
      refreshAddRowSelectors();
      renderAuthMethodTable(getAuthCatalog()?.auth_methods || []);
    };

    q('addProviderRow').onclick = () => {
      const id = q('providerAddSelect').value;
      if (!id) {
        setStatus('providerStatus', 'no hidden/disabled provider rows to add', { type: 'warn', title: 'Provider Vault' });
        return;
      }
      const next = getHiddenProviderRows().filter((row) => row !== id);
      setHiddenProviderRows(next);
      normalizeHiddenRows();
      refreshAddRowSelectors();
      renderProviderMatrix(getAuthCatalog()?.providers || []);
      setStatus('providerStatus', `added provider row ${id}`, { type: 'success', title: 'Provider Vault' });
      runWebuiWireValidation(`provider_add_row:${id}`).catch(() => {});
    };

    q('addServiceRow').onclick = () => {
      const id = q('serviceAddSelect').value;
      if (!id) {
        setStatus('providerStatus', 'no hidden service rows to add', { type: 'warn', title: 'Provider Vault' });
        return;
      }
      const next = getHiddenServiceRows().filter((row) => row !== id);
      setHiddenServiceRows(next);
      normalizeHiddenRows();
      refreshAddRowSelectors();
      renderAuthMethodTable(getAuthCatalog()?.auth_methods || []);
      setStatus('providerStatus', `added service row ${id}`, { type: 'success', title: 'Provider Vault' });
      runWebuiWireValidation(`service_add_row:${id}`).catch(() => {});
    };

    q('addFallbackRow').onclick = () => {
      const provider = q('fallbackProviderPicker').value;
      if (!canAddFallbackProvider(provider, q('provider').value, getFallbackSequence())) return;
      setFallbackSequence([...getFallbackSequence(), { provider, model: preferredModelForProvider(provider) }]);
      q('fallbackProviderPicker').value = '';
      renderFallbackSequence();
    };

    q('autoFillFallbacks').onclick = () => {
      const primary = q('provider').value;
      setFallbackSequence(autoFillFallbackSequence(getModelProviderIds(), primary, preferredModelForProvider));
      renderFallbackSequence();
    };

    q('saveRuntime').onclick = async () => {
      const out = await jpost('/api/config', {
        runtime: {
          autonomyMode: q('autonomyMode').value,
          shellEnabled: q('shellEnabled').value === 'true',
          maxToolIterations: Number(q('maxIters').value || 8)
        },
        model: {
          routing: {
            fallbackEnabled: q('fallbackEnabled').value === 'true',
            fallbackProviders: getFallbackSequence().map((entry) => entry.provider)
          }
        }
      });
      setStatus(
        'runtimeStatus',
        `saved mode=${out.runtime.autonomyMode || q('autonomyMode').value} shell=${out.runtime.shellEnabled} maxIters=${out.runtime.maxToolIterations}`,
        { type: 'success', title: 'Runtime' }
      );
      await refreshRuntimeOverview();
      await runWebuiWireValidation('runtime_save');
    };

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

  return {
    bindSettingsActions
  };
}
