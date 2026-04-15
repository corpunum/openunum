export function bindSettingsModelRoutingActions(ctx) {
  const {
    q,
    jpost,
    runWebuiWireValidation,
    setStatus,
    topStatus,
    formatProviderModel,
    buildProviderModelsPatch,
    computeOnlineFallbackSequence,
    ensureFallbackSequence,
    getModelCatalog,
    getFallbackSequence,
    refreshModel,
    refreshModelCatalog,
    refreshRuntimeOverview,
    refreshAutonomyDashboard,
    loadModelsForProvider
  } = ctx;

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
    if (refreshAutonomyDashboard) await refreshAutonomyDashboard();
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
    if (refreshAutonomyDashboard) await refreshAutonomyDashboard();
    await runWebuiWireValidation('routing_save');
  };
}

