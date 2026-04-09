export function createProviderVaultActions({
  q,
  escapeHtml,
  setStatus,
  jpost,
  jget,
  providerCatalogRow,
  getAuthCatalog,
  runWebuiWireValidation,
  refreshProviderConfig,
  refreshModelCatalog,
  refreshRuntimeOverview,
  buildProviderAuthCatalogPayload,
  buildProviderTestRequest,
  buildServiceSavePayload,
  buildServiceTestRequest,
  formatProviderTestStatus,
  formatServiceTestStatus,
  PROVIDER_SECRET_FIELD,
  PROVIDER_BASE_FIELD,
  SERVICE_SECRET_FIELD,
  vaultModalState,
  authJobPrompted,
  closeVaultModal,
  onAuthCatalogRefresh
}) {
  function authMethodById(id) {
    return (getAuthCatalog()?.auth_methods || []).find((row) => row.id === id) || null;
  }

  function openVaultModal({ kind, id }) {
    const modal = q('vaultEditModal');
    const title = q('vaultEditTitle');
    const body = q('vaultEditBody');
    if (!modal || !title || !body) return;
    const safeKind = String(kind || '').trim();
    const safeId = String(id || '').trim();
    if (!safeKind || !safeId) return;
    vaultModalState.kind = safeKind;
    vaultModalState.id = safeId;
    if (safeKind === 'provider') {
      const row = providerCatalogRow(safeId);
      if (!row) return;
      const secretField = PROVIDER_SECRET_FIELD[safeId];
      title.textContent = `Provider Vault: ${safeId}`;
      body.innerHTML = `
        <div class="field">
          <label>Provider ID</label>
          <input id="vaultProviderId" class="mono" value="${escapeHtml(safeId)}" readonly />
        </div>
        <div class="field">
          <label>Base URL</label>
          <input id="vaultProviderBase" class="mono" value="${escapeHtml(row.base_url || '')}" placeholder="https://..." />
        </div>
        ${secretField ? `
          <div class="field">
            <label>API Key / Token</label>
            <input id="vaultProviderSecret" class="mono" value="" placeholder="${escapeHtml(row.stored_preview ? `current ${row.stored_preview}` : 'enter new secret')}" />
          </div>
        ` : ''}
        <div class="field">
          <label>Status</label>
          <input class="mono" value="${escapeHtml(row.status || 'unknown')}" readonly />
        </div>
        <div class="field">
          <label>Top Model</label>
          <input class="mono" value="${escapeHtml(row.top_model || '')}" readonly />
        </div>
      `;
    } else {
      const row = authMethodById(safeId);
      if (!row) return;
      const secretField = SERVICE_SECRET_FIELD[safeId];
      title.textContent = `Service Vault: ${safeId}`;
      body.innerHTML = `
        <div class="field">
          <label>Service ID</label>
          <input class="mono" value="${escapeHtml(safeId)}" readonly />
        </div>
        <div class="field">
          <label>Auth Kind</label>
          <input class="mono" value="${escapeHtml(row.auth_kind || 'unknown')}" readonly />
        </div>
        ${secretField ? `
          <div class="field">
            <label>Secret / Token</label>
            <input id="vaultServiceSecret" class="mono" value="" placeholder="${escapeHtml(row.stored_preview ? `current ${row.stored_preview}` : 'enter new secret')}" />
          </div>
        ` : ''}
        ${safeId === 'google-workspace' ? `
          <div class="field">
            <label>OAuth Client ID</label>
            <input id="vaultGoogleClientId" class="mono" value="${escapeHtml(row.oauth_client_id || '')}" placeholder="google desktop oauth client id" />
          </div>
          <div class="field">
            <label>OAuth Client Secret</label>
            <input id="vaultGoogleClientSecret" class="mono" value="" placeholder="${escapeHtml(row.oauth_client_secret_preview ? `current ${row.oauth_client_secret_preview}` : 'optional')}" />
          </div>
          <div class="field">
            <label>Scopes</label>
            <textarea id="vaultGoogleScopes" class="mono" rows="4">${escapeHtml(row.oauth_scopes || '')}</textarea>
          </div>
        ` : ''}
      `;
    }
    modal.showModal();
  }

  async function saveVaultModal() {
    if (vaultModalState.kind === 'provider') {
      const provider = vaultModalState.id;
      const row = providerCatalogRow(provider);
      if (!row) return;
      const secretField = PROVIDER_SECRET_FIELD[provider];
      const baseField = PROVIDER_BASE_FIELD[provider];
      const baseValue = q('vaultProviderBase')?.value?.trim() || row.base_url || '';
      const secretValue = q('vaultProviderSecret')?.value?.trim() || '';
      const payload = {
        providerBaseUrls: baseField ? { [baseField]: baseValue } : {},
        secrets: secretField && secretValue ? { [secretField]: secretValue } : {}
      };
      await jpost('/api/auth/catalog', payload);
      setStatus('providerStatus', `saved ${provider}`, { type: 'success', title: 'Provider Vault' });
      await refreshProviderConfig();
      await refreshModelCatalog();
      await refreshRuntimeOverview();
      await runWebuiWireValidation(`provider_save:${provider}`);
      closeVaultModal();
      return;
    }
    if (vaultModalState.kind === 'service') {
      const service = vaultModalState.id;
      const secretField = SERVICE_SECRET_FIELD[service];
      if (service === 'google-workspace') {
        const payload = {
          oauthConfig: {
            googleWorkspace: {
              clientId: q('vaultGoogleClientId')?.value?.trim() || '',
              scopes: q('vaultGoogleScopes')?.value?.trim() || ''
            }
          }
        };
        const secret = q('vaultGoogleClientSecret')?.value?.trim() || '';
        if (secret) payload.oauthConfig.googleWorkspace.clientSecret = secret;
        await jpost('/api/auth/catalog', payload);
      } else if (secretField) {
        const secret = q('vaultServiceSecret')?.value?.trim() || '';
        await jpost('/api/auth/catalog', secret ? { secrets: { [secretField]: secret } } : { clear: [secretField] });
      }
      setStatus('providerStatus', `saved ${service}`, { type: 'success', title: 'Service Vault' });
      await refreshProviderConfig();
      await refreshRuntimeOverview();
      await runWebuiWireValidation(`service_save:${service}`);
      closeVaultModal();
    }
  }

  async function testVaultModal() {
    if (vaultModalState.kind === 'provider') {
      const provider = vaultModalState.id;
      const row = providerCatalogRow(provider);
      if (!row) return;
      const baseUrl = q('vaultProviderBase')?.value?.trim() || row.base_url || '';
      const apiKey = q('vaultProviderSecret')?.value?.trim() || '';
      const out = await jpost('/api/provider/test', { provider, baseUrl, apiKey });
      setStatus(
        'providerStatus',
        out.ok
          ? `test ok ${provider} | models=${Number(out.modelCount || 0)} | top=${out.topModel || '-'}`
          : `test failed ${provider} | ${out.error || 'unknown'}`,
        { type: out.ok ? 'success' : 'error', title: 'Provider Test' }
      );
      return;
    }
    if (vaultModalState.kind === 'service') {
      const service = vaultModalState.id;
      const secret = q('vaultServiceSecret')?.value?.trim() || '';
      const out = await jpost('/api/service/test', { service, secret });
      setStatus(
        'providerStatus',
        out.ok
          ? `test ok ${service}${out.account ? ` | ${out.account}` : ''}${out.modelCount ? ` | models=${Number(out.modelCount)}` : ''}`
          : `test failed ${service} | ${out.error || 'unknown'}`,
        { type: out.ok ? 'success' : 'error', title: 'Service Test' }
      );
    }
  }

  async function saveProviderRow(provider) {
    const row = providerCatalogRow(provider);
    if (!row) return;
    const secretField = PROVIDER_SECRET_FIELD[provider];
    const baseField = PROVIDER_BASE_FIELD[provider];
    const secretInput = document.querySelector(`.provider-secret-input[data-provider="${provider}"]`);
    const baseInput = document.querySelector(`.provider-base-input[data-provider="${provider}"]`);
    const payload = buildProviderAuthCatalogPayload({
      row,
      secretField,
      baseField,
      baseInputValue: baseInput?.value,
      secretInputValue: secretInput?.value
    });
    await jpost('/api/auth/catalog', payload);
    setStatus('providerStatus', `saved ${provider}`, { type: 'success', title: 'Provider Vault' });
    await refreshProviderConfig();
    await refreshModelCatalog();
    await refreshRuntimeOverview();
    await runWebuiWireValidation(`provider_save:${provider}`);
  }

  async function testProviderRow(provider) {
    const row = providerCatalogRow(provider);
    if (!row) return;
    const secretInput = document.querySelector(`.provider-secret-input[data-provider="${provider}"]`);
    const baseInput = document.querySelector(`.provider-base-input[data-provider="${provider}"]`);
    const out = await jpost('/api/provider/test', buildProviderTestRequest({
      provider,
      row,
      baseInputValue: baseInput?.value,
      secretInputValue: secretInput?.value
    }));
    setStatus(
      'providerStatus',
      formatProviderTestStatus(provider, out),
      { type: out.ok ? 'success' : 'error', title: 'Provider Test' }
    );
  }

  async function saveServiceRow(service) {
    const authRow = authMethodById(service);
    if (!authRow) return;
    const secretField = SERVICE_SECRET_FIELD[service];
    const payload = buildServiceSavePayload({
      service,
      secretField,
      secret: document.querySelector(`.service-secret-input[data-service="${service}"]`)?.value,
      clientId: document.querySelector(`.service-oauth-client-id[data-service="${service}"]`)?.value,
      clientSecret: document.querySelector(`.service-oauth-client-secret[data-service="${service}"]`)?.value,
      scopes: document.querySelector(`.service-oauth-scopes[data-service="${service}"]`)?.value
    });
    if (service === 'google-workspace') {
      await jpost('/api/auth/catalog', payload);
      setStatus('providerStatus', `saved ${service}`, { type: 'success', title: 'Service Vault' });
      await onAuthCatalogRefresh();
      await runWebuiWireValidation(`service_save:${service}`);
      return;
    }
    if (!payload) return;
    await jpost('/api/auth/catalog', payload);
    setStatus('providerStatus', `saved ${service}`, { type: 'success', title: 'Service Vault' });
    await refreshProviderConfig();
    await refreshRuntimeOverview();
    await runWebuiWireValidation(`service_save:${service}`);
  }

  async function testServiceRow(service) {
    const input = document.querySelector(`.service-secret-input[data-service="${service}"]`);
    const out = await jpost('/api/service/test', buildServiceTestRequest({ service, secret: input?.value }));
    setStatus(
      'providerStatus',
      formatServiceTestStatus(service, out),
      { type: out.ok ? 'success' : 'error', title: 'Service Test' }
    );
  }

  async function connectServiceRow(service) {
    if (service === 'google-workspace') {
      await saveServiceRow(service);
    }
    const out = await jpost('/api/service/connect', { service });
    if (out.job?.id) {
      setStatus('providerStatus', `oauth started ${service} | waiting for browser sign-in`, { type: 'info', title: 'OAuth' });
      if (out.job.authUrl) {
        try {
          window.open(out.job.authUrl, '_blank', 'noopener');
        } catch {}
      }
      await pollAuthJob(out.job.id, service);
      return;
    }
    setStatus(
      'providerStatus',
      out.started
        ? `oauth started ${service} | launcher=${out.launcher || 'shell'} | command=${out.command}`
        : `oauth unavailable ${service} | ${out.prerequisite || out.error || 'not_supported'}`,
      { type: out.started ? 'info' : 'warn', title: 'OAuth' }
    );
    await onAuthCatalogRefresh();
  }

  async function pollAuthJob(jobId, service) {
    authJobPrompted[jobId] = false;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const out = await jget(`/api/auth/job?id=${encodeURIComponent(jobId)}`);
      const job = out.job || {};
      if (job.status === 'awaiting_browser') {
        setStatus('providerStatus', `oauth ${service}: waiting for browser completion`, { toast: false });
        if (job.authUrl && !job.browserOpened) {
          try {
            window.open(job.authUrl, '_blank', 'noopener');
          } catch {}
        }
      } else if (job.status === 'awaiting_input') {
        setStatus('providerStatus', `oauth ${service}: manual code input required`, { type: 'warn', title: 'OAuth' });
        if (!authJobPrompted[jobId]) {
          authJobPrompted[jobId] = true;
          const input = window.prompt(job.promptMessage || 'Paste the authorization code or redirect URL');
          if (input && input.trim()) {
            await jpost('/api/auth/job/input', { id: jobId, input: input.trim() });
          }
        }
      } else if (job.status === 'completed') {
        setStatus(
          'providerStatus',
          `oauth complete ${service}${job.account ? ` | ${job.account}` : ''}`,
          { type: 'success', title: 'OAuth' }
        );
        await onAuthCatalogRefresh();
        await refreshRuntimeOverview();
        return;
      } else if (job.status === 'failed') {
        setStatus('providerStatus', `oauth failed ${service} | ${job.error || 'unknown'}`, { type: 'error', title: 'OAuth' });
        await onAuthCatalogRefresh();
        return;
      } else {
        setStatus('providerStatus', `oauth ${service}: ${job.progress || job.status || 'starting'}`, { toast: false });
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setStatus('providerStatus', `oauth ${service}: timeout waiting for completion`, { type: 'warn', title: 'OAuth' });
  }

  return {
    openVaultModal,
    saveVaultModal,
    testVaultModal,
    saveProviderRow,
    testProviderRow,
    saveServiceRow,
    testServiceRow,
    connectServiceRow,
    pollAuthJob,
    authMethodById
  };
}
