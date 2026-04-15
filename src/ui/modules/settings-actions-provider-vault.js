export function bindSettingsProviderVaultActions(ctx) {
  const {
    q,
    jpost,
    runWebuiWireValidation,
    setStatus,
    computeOnlineFallbackSequence,
    canAddFallbackProvider,
    autoFillFallbackSequence,
    getModelProviderIds,
    getModelCatalog,
    getFallbackSequence,
    setFallbackSequence,
    preferredModelForProvider,
    normalizeHiddenRows,
    refreshAddRowSelectors,
    renderProviderMatrix,
    renderAuthMethodTable,
    refreshProviderConfig,
    refreshModelCatalog,
    refreshRuntimeOverview,
    refreshAutonomyDashboard,
    renderFallbackSequence,
    getHiddenProviderRows,
    setHiddenProviderRows,
    getHiddenServiceRows,
    setHiddenServiceRows,
    getAuthCatalog
  } = ctx;

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
    if (refreshAutonomyDashboard) await refreshAutonomyDashboard();
    await runWebuiWireValidation('prefill_local_auth');
  };

  q('refreshAuthCatalog').onclick = async () => {
    await refreshProviderConfig();
    await refreshModelCatalog();
    await refreshRuntimeOverview();
    if (refreshAutonomyDashboard) await refreshAutonomyDashboard();
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
          fallbackProviders: computeOnlineFallbackSequence(getFallbackSequence(), getModelCatalog()).map((entry) => entry.provider)
        }
      }
    });
    setStatus(
      'runtimeStatus',
      `saved mode=${out.runtime.autonomyMode || q('autonomyMode').value} shell=${out.runtime.shellEnabled} maxIters=${out.runtime.maxToolIterations}`,
      { type: 'success', title: 'Runtime' }
    );
    await refreshRuntimeOverview();
    if (refreshAutonomyDashboard) await refreshAutonomyDashboard();
    await runWebuiWireValidation('runtime_save');
  };
}

