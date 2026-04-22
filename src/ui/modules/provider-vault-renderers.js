export function createProviderVaultRenderers({
  q,
  qa,
  jget,
  jpost,
  escapeHtml,
  renderStatusBadge,
  providerSummaryText,
  serviceSummaryText,
  setStatus,
  openVaultModal,
  saveProviderRow,
  testProviderRow,
  saveServiceRow,
  testServiceRow,
  connectServiceRow,
  setSelectByValueOrFirst,
  loadModelsForProvider,
  showView,
  stripProviderPrefix,
  runWebuiWireValidation,
  refreshRuntime,
  refreshProviderConfig,
  refreshModelCatalog,
  refreshRuntimeOverview,
  normalizeHiddenRows,
  refreshAddRowSelectors,
  getAuthCatalog,
  getRuntimeConfigCache,
  setRuntimeConfigCache,
  getModelProviderIds,
  getProviderSecretField,
  getServiceSecretField,
  getHiddenProviderRows,
  setHiddenProviderRows,
  getHiddenServiceRows,
  setHiddenServiceRows,
  getProviderAdvancedOpen,
  getServiceAdvancedOpen
}) {
  function renderProviderMatrix(providers = []) {
    const host = q('providerMatrixBody');
    if (!host) return;
    const hiddenProviderRows = getHiddenProviderRows();
    const providerAdvancedOpen = getProviderAdvancedOpen();
    const authCatalog = getAuthCatalog();
    const visibleRows = providers.filter((provider) => !hiddenProviderRows.includes(provider.provider));
    host.innerHTML = visibleRows.flatMap((provider) => {
      const authField = getProviderSecretField()[provider.provider];
      const advancedOpen = Boolean(providerAdvancedOpen[provider.provider]);
      const isDisabled = Boolean(provider.disabled);
      const authPlaceholder = String(provider.provider || '').startsWith('ollama-') || provider.provider === 'llama-cpp-local'
        ? 'local/no key'
        : provider.provider === 'nvidia'
          ? 'nvapi-...'
          : provider.provider === 'openrouter'
            ? 'sk-or-...'
            : provider.provider === 'xiaomimimo'
              ? 'sk-...'
              : 'sk-...';
      const inputPlaceholder = provider.stored_preview
        ? `current ${provider.stored_preview}`
        : (provider.discovered_source ? 'discovered locally' : authPlaceholder);
      const rowOpacity = isDisabled ? 'style="opacity: 0.5;"' : '';
      const disabledBadge = isDisabled ? '<span class="badge" style="background: #333; border-color: #666; color: #999; margin-left: 8px;">DISABLED</span>' : '';
      const mainRow = `
      <tr ${rowOpacity}>
        <td>
          <div class="summary-stack">
            <div class="summary-line"><strong>${escapeHtml(provider.display_name || provider.provider)}</strong>${disabledBadge}</div>
            <div class="summary-sub provider-open" data-provider="${provider.provider}" style="cursor:pointer;text-decoration:underline;">${escapeHtml(provider.provider)}</div>
          </div>
        </td>
        <td>${renderStatusBadge(provider.status || 'unknown', escapeHtml)}</td>
        <td>
          ${authField ? `<input class="provider-secret-input" data-provider="${provider.provider}" placeholder="${escapeHtml(inputPlaceholder)}" value="" />` : '<span class="pill">local</span>'}
          <div class="hint" style="margin-top:6px;">${provider.auth_ready ? 'ready' : 'not ready'}${provider.discovered_source ? ` | ${escapeHtml(provider.discovered_source)}` : ''}</div>
        </td>
        <td>
          <div class="summary-stack">
            <div class="summary-line">${escapeHtml(providerSummaryText(provider))}</div>
            <div class="summary-sub">${provider.degraded_reason ? escapeHtml(provider.degraded_reason) : 'catalog available'}</div>
          </div>
        </td>
        <td>
          <div class="row compact-actions">
            <button type="button" class="provider-save" data-provider="${provider.provider}">Save</button>
            <button type="button" class="provider-test" data-provider="${provider.provider}">Test</button>
            <button type="button" class="provider-disable" data-provider="${provider.provider}" style="background-color: ${provider.disabled ? '#555' : '#822'}; color: white;">${provider.disabled ? 'Enable' : 'Disable'}</button>
            <button type="button" class="provider-use" data-provider="${provider.provider}">Use</button>
            <button type="button" class="provider-modal" data-provider="${provider.provider}">Edit Vault</button>
            <button type="button" class="provider-delete" data-provider="${provider.provider}">Remove</button>
            <button type="button" class="provider-advanced" data-provider="${provider.provider}">${advancedOpen ? 'Hide' : 'Edit'}</button>
            <button type="button" class="provider-hide" data-provider="${provider.provider}">Hide</button>
          </div>
        </td>
      </tr>`;
      const detailRow = advancedOpen ? `
      <tr>
        <td colspan="5">
          <div class="soft-panel grid two">
            <div class="field">
              <label>Resolved Base URL</label>
              <input class="provider-base-input mono" data-provider="${provider.provider}" value="${escapeHtml(provider.base_url || '')}" />
            </div>
            <div class="field">
              <label>Discovery / State</label>
              <div class="hint">auth_ready=${provider.auth_ready} | source=${escapeHtml(provider.discovered_source || provider.base_url_source || '-')}</div>
              <div class="hint">${provider.degraded_reason ? escapeHtml(provider.degraded_reason) : 'No degradation detail.'}</div>
            </div>
          </div>
        </td>
      </tr>` : '';
      return [mainRow, detailRow];
    }).join('');

    qa('.provider-save').forEach((btn) => { btn.onclick = () => saveProviderRow(btn.dataset.provider); });
    qa('.provider-test').forEach((btn) => { btn.onclick = () => testProviderRow(btn.dataset.provider); });
    qa('.provider-disable').forEach((btn) => {
      btn.onclick = async () => {
        const provider = btn.dataset.provider;
        const cp = authCatalog.providers.find((p) => p.provider === provider);
        let runtimeConfigCache = getRuntimeConfigCache();
        runtimeConfigCache = runtimeConfigCache || await jget('/api/config');
        if (runtimeConfigCache?.model?.provider === provider && !cp?.disabled) {
          setStatus('providerStatus', `switch primary provider before disabling ${provider}`, { type: 'warn', title: 'Provider Vault' });
          return;
        }
        const existingDisabled = runtimeConfigCache?.model?.routing?.disabledProviders || [];
        const nextDisabled = !cp.disabled;
        await jpost('/api/config', {
          model: {
            routing: {
              disabledProviders: nextDisabled
                ? [...new Set([...existingDisabled, provider])]
                : existingDisabled.filter((p) => p !== provider)
            }
          }
        });
        setRuntimeConfigCache(null);
        await refreshProviderConfig();
        await refreshModelCatalog();
        await runWebuiWireValidation(`provider_toggle:${provider}`);
      };
    });
    qa('.provider-use').forEach((btn) => {
      btn.onclick = async () => {
        setSelectByValueOrFirst('provider', btn.dataset.provider || 'ollama-cloud');
        await loadModelsForProvider(q('provider').value);
        showView('model-routing');
      };
    });
    qa('.provider-advanced').forEach((btn) => {
      btn.onclick = () => {
        providerAdvancedOpen[btn.dataset.provider] = !providerAdvancedOpen[btn.dataset.provider];
        renderProviderMatrix(getAuthCatalog()?.providers || []);
      };
    });
    qa('.provider-modal').forEach((btn) => {
      btn.onclick = () => openVaultModal({ kind: 'provider', id: btn.dataset.provider });
    });
    qa('.provider-open').forEach((btn) => {
      btn.onclick = () => openVaultModal({ kind: 'provider', id: btn.dataset.provider });
    });
    qa('.provider-delete').forEach((btn) => {
      btn.onclick = async () => {
        const provider = String(btn.dataset.provider || '').trim();
        if (!provider) return;
        let runtimeConfigCache = getRuntimeConfigCache();
        runtimeConfigCache = runtimeConfigCache || await jget('/api/config');
        if (runtimeConfigCache?.model?.provider === provider) {
          setStatus('providerStatus', `switch primary provider before removing ${provider}`, { type: 'warn', title: 'Provider Vault' });
          return;
        }
        const providerModels = { ...(runtimeConfigCache?.model?.providerModels || {}) };
        delete providerModels[provider];
        const fallbackProviders = (runtimeConfigCache?.model?.routing?.fallbackProviders || []).filter((p) => p !== provider);
        const disabledProviders = [...new Set([...(runtimeConfigCache?.model?.routing?.disabledProviders || []), provider])];
        const modelPatch = { providerModels, routing: { fallbackProviders, disabledProviders } };
        await jpost('/api/config', { model: modelPatch });
        setRuntimeConfigCache(null);
        setStatus('providerStatus', `removed from routing ${provider}`, { type: 'warn', title: 'Provider Vault' });
        await refreshRuntime();
        await refreshProviderConfig();
        await refreshModelCatalog();
        await runWebuiWireValidation(`provider_remove:${provider}`);
      };
    });
    qa('.provider-hide').forEach((btn) => {
      btn.onclick = () => {
        const next = [...getHiddenProviderRows()];
        if (!next.includes(btn.dataset.provider)) next.push(btn.dataset.provider);
        setHiddenProviderRows(next);
        normalizeHiddenRows();
        refreshAddRowSelectors();
        renderProviderMatrix(getAuthCatalog()?.providers || []);
      };
    });
  }

  function renderAuthMethodTable(rows = []) {
    const host = q('authMethodBody');
    if (!host) return;
    const hiddenServiceRows = getHiddenServiceRows();
    const serviceAdvancedOpen = getServiceAdvancedOpen();
    const visibleRows = rows.filter((row) => !hiddenServiceRows.includes(row.id));
    host.innerHTML = visibleRows.flatMap((row) => {
      const advancedOpen = Boolean(serviceAdvancedOpen[row.id]);
      const secretField = getServiceSecretField()[row.id];
      const authCell = secretField
        ? `<input class="service-secret-input" data-service="${row.id}" placeholder="${escapeHtml(row.stored_preview ? `current ${row.stored_preview}` : (row.auth_kind || 'credential'))}" value="" />`
        : `<span class="pill">${escapeHtml(row.cli?.authenticated ? 'oauth active' : row.auth_kind || 'oauth')}</span>`;
      const hasOauth = row.id === 'github' || row.id === 'google-workspace' || row.id === 'openai-oauth';
      const mainRow = `
      <tr>
        <td>
          <div class="summary-stack">
            <div class="summary-line"><strong>${escapeHtml(row.display_name || row.id)}</strong></div>
            <div class="summary-sub">${escapeHtml(row.id)}</div>
          </div>
        </td>
        <td>${renderStatusBadge(row.configured ? 'configured' : (row.cli?.authenticated ? 'authenticated' : (row.cli?.available ? 'available' : 'missing')), escapeHtml)}</td>
        <td>
          ${authCell}
          <div class="hint" style="margin-top:6px;">${escapeHtml(serviceSummaryText(row))}</div>
        </td>
        <td>
          <div class="row compact-actions">
            ${secretField ? `<button type="button" class="service-save" data-service="${row.id}">Save</button><button type="button" class="service-test" data-service="${row.id}">Test</button>` : `<button type="button" class="service-test" data-service="${row.id}">Test</button>`}
            ${hasOauth ? `<button type="button" class="service-connect" data-service="${row.id}">Connect</button>` : ''}
            <button type="button" class="service-modal" data-service="${row.id}">Edit Vault</button>
            <button type="button" class="service-delete" data-service="${row.id}">Delete</button>
            <button type="button" class="service-advanced" data-service="${row.id}">${advancedOpen ? 'Hide' : 'Advanced'}</button>
            <button type="button" class="service-hide" data-service="${row.id}">Hide</button>
          </div>
        </td>
      </tr>`;
      const detailRow = advancedOpen ? `
      <tr>
        <td colspan="4">
          <div class="soft-panel">
            ${row.id === 'google-workspace' ? `
              <div class="grid two">
                <div class="field">
                  <label>OAuth Client ID</label>
                  <input class="service-oauth-client-id mono" data-service="${row.id}" value="${escapeHtml(row.oauth_client_id || '')}" placeholder="Google Desktop OAuth Client ID or downloaded OAuth JSON" />
                </div>
                <div class="field">
                  <label>OAuth Client Secret</label>
                  <input class="service-oauth-client-secret mono" data-service="${row.id}" value="" placeholder="${escapeHtml(row.oauth_client_secret_preview ? `current ${row.oauth_client_secret_preview}` : 'optional')}" />
                </div>
              </div>
              <div class="field" style="margin-top:10px;">
                <label>Scopes</label>
                <textarea class="service-oauth-scopes mono" data-service="${row.id}" rows="3">${escapeHtml(row.oauth_scopes || '')}</textarea>
              </div>
            ` : ''}
            <div class="hint">mode=${escapeHtml(row.auth_kind || '-')} | source=${escapeHtml(row.discovered_source || '-')}</div>
            <div class="hint">cli=${escapeHtml(row.cli?.cli || 'n/a')} | detail=${escapeHtml(row.cli?.detail || 'manual')}</div>
          </div>
        </td>
      </tr>` : '';
      return [mainRow, detailRow];
    }).join('');

    qa('.service-save').forEach((btn) => { btn.onclick = () => saveServiceRow(btn.dataset.service); });
    qa('.service-test').forEach((btn) => { btn.onclick = () => testServiceRow(btn.dataset.service); });
    qa('.service-connect').forEach((btn) => { btn.onclick = () => connectServiceRow(btn.dataset.service); });
    qa('.service-modal').forEach((btn) => {
      btn.onclick = () => openVaultModal({ kind: 'service', id: btn.dataset.service });
    });
    qa('.service-delete').forEach((btn) => {
      btn.onclick = async () => {
        const service = String(btn.dataset.service || '').trim();
        const secretField = getServiceSecretField()[service];
        if (!secretField) {
          setStatus('providerStatus', `delete skipped ${service} (oauth/manual only)`, { type: 'warn', title: 'Service Vault' });
          return;
        }
        await jpost('/api/auth/catalog', { clear: [secretField] });
        setStatus('providerStatus', `deleted ${service}`, { type: 'warn', title: 'Service Vault' });
        await refreshProviderConfig();
        await refreshRuntimeOverview();
        await runWebuiWireValidation(`service_delete:${service}`);
      };
    });
    qa('.service-advanced').forEach((btn) => {
      btn.onclick = () => {
        serviceAdvancedOpen[btn.dataset.service] = !serviceAdvancedOpen[btn.dataset.service];
        renderAuthMethodTable(getAuthCatalog()?.auth_methods || []);
      };
    });
    qa('.service-hide').forEach((btn) => {
      btn.onclick = () => {
        const next = [...getHiddenServiceRows()];
        if (!next.includes(btn.dataset.service)) next.push(btn.dataset.service);
        setHiddenServiceRows(next);
        normalizeHiddenRows();
        refreshAddRowSelectors();
        renderAuthMethodTable(getAuthCatalog()?.auth_methods || []);
      };
    });
  }

  return {
    renderProviderMatrix,
    renderAuthMethodTable
  };
}
