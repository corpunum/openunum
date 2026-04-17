export function createModelCatalogController({
  q,
  jget,
  escapeHtml,
  stripProviderPrefix,
  setSelectByValueOrFirst,
  topStatus,
  formatProviderModel,
  getModelProviderIds,
  getModelCatalog,
  setModelCatalog,
  getRuntimeConfigCache,
  setRuntimeConfigCache,
  renderProviderSelectors,
  renderFallbackSequence
}) {
  async function refreshModel() {
    const m = await jget('/api/model/current');
    setSelectByValueOrFirst('provider', m.provider);
    if (topStatus) {
      topStatus.textContent = `cfg=${formatProviderModel(m.provider, m.model)} active=${formatProviderModel(m.activeProvider, m.activeModel)}`;
    }
  }

  async function refreshModelCatalog() {
    const data = await jget('/api/model-catalog');
    setModelCatalog(data);
    const statusEl = q('modelCatalogStatus');
    if (statusEl) {
      statusEl.textContent = `catalog ${data.contract_version} | providers=${(data.providers || []).length}`;
    }
    renderProviderSelectors();
    renderProviderCards(data.providers || []);
    renderFallbackSequence();
    return data;
  }

  function renderProviderCards(providers = []) {
    const host = q('providerCards');
    if (!host) return;
    host.innerHTML = (providers || []).map((provider) => `
      <div class="provider-card ${provider.status}">
        <div class="row" style="justify-content:space-between;">
          <strong>${escapeHtml(provider.display_name || provider.provider)}</strong>
          <span class="pill">${escapeHtml(provider.status)}</span>
        </div>
        <div class="hint" style="margin-top:6px;">#1 ${escapeHtml(provider.top_model || provider.models?.[0]?.model_id || '-')}</div>
        <div class="hint">models=${Number(provider.model_count ?? provider.models?.length ?? 0)}</div>
        ${provider.degraded_reason ? `<div class="hint" style="color:#facc15;">${escapeHtml(provider.degraded_reason)}</div>` : ''}
      </div>
    `).join('');
  }

  async function loadModelsForProvider(provider, currentModel = '') {
    try {
      if (!getModelCatalog()) await refreshModelCatalog();
      const out = await jget(`/api/models?provider=${encodeURIComponent(provider)}`);
      const list = q('modelList');
      list.innerHTML = '';
      const models = out.models || [];
      for (const m of models) {
        const opt = document.createElement('option');
        const modelId = m.model_id || m.id || '';
        opt.value = modelId;
        const score = m.capability_score ?? m.score ?? '?';
        const ctx = m.context_window || m.contextWindow || '?';
        const rank = m.rank ? `#${m.rank}` : '#?';
        opt.textContent = `${rank} ${modelId} | score=${score} | ctx=${ctx}`;
        list.appendChild(opt);
      }
      const normalizedCurrentModel = stripProviderPrefix(currentModel, getModelProviderIds());
      if (normalizedCurrentModel && models.some((m) => (m.model_id || m.id) === normalizedCurrentModel)) {
        list.value = normalizedCurrentModel;
      }
      q('modelCatalogStatus').textContent = `loaded ${models.length} ${provider} models`;
    } catch (error) {
      q('modelCatalogStatus').textContent = `load failed: ${String(error.message || error)}`;
    }
  }

  return {
    refreshModel,
    refreshModelCatalog,
    renderProviderCards,
    loadModelsForProvider
  };
}
