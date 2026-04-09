export function createRuntimeRefreshers({
  q,
  jget,
  setStatus,
  normalizeServiceCapabilityIds,
  stripProviderPrefix,
  preferredModelForProvider,
  setSelectByValueOrFirst,
  renderProviderSelectors,
  renderFallbackSequence,
  normalizeHiddenRows,
  refreshAddRowSelectors,
  renderProviderMatrix,
  renderAuthMethodTable,
  getModelProviderIds,
  setModelProviderIds,
  getServiceProviderIds,
  setServiceProviderIds,
  getRuntimeConfigCache,
  setRuntimeConfigCache,
  getAuthCatalog,
  setAuthCatalog,
  getFallbackSequence,
  setFallbackSequence,
  getServiceSecretField
}) {
  async function refreshCapabilities() {
    const caps = await jget('/api/capabilities');
    const providers = Array.isArray(caps?.provider_order) ? caps.provider_order : [];
    const services = Array.isArray(caps?.services) ? caps.services : [];
    if (providers.length) {
      setModelProviderIds([...new Set(providers.map((p) => String(p || '').trim()).filter(Boolean))]);
    }
    if (services.length) {
      setServiceProviderIds(normalizeServiceCapabilityIds(
        services,
        Object.keys(getServiceSecretField() || {})
      ));
    }
    renderProviderSelectors();
    normalizeHiddenRows();
    refreshAddRowSelectors();
    return caps;
  }

  async function refreshAuthCatalog() {
    try {
      const catalog = await jget('/api/auth/catalog');
      if (!catalog) throw new Error('catalog_is_null');
      setAuthCatalog(catalog);

      const providerIds = Array.isArray(catalog?.provider_order)
        ? catalog.provider_order
        : (catalog?.providers || []).map((row) => row.provider);
      if (providerIds?.length) {
        setModelProviderIds([...new Set(providerIds.map((id) => String(id || '').trim()).filter(Boolean))]);
      }
      const serviceIds = (catalog?.auth_targets || catalog?.auth_methods || [])
        .map((row) => String(row?.id || '').trim())
        .filter(Boolean);
      if (serviceIds.length) {
        setServiceProviderIds([...new Set(serviceIds)]);
      }
      renderProviderSelectors();
      normalizeHiddenRows();
      refreshAddRowSelectors();
      renderProviderMatrix(catalog.providers || []);
      renderAuthMethodTable(catalog.auth_methods || []);
      const authById = Object.fromEntries((catalog.auth_methods || []).map((row) => [row.id, row]));
      const secretStoreBackend = catalog.secret_store?.backend || 'plaintext';
      const secretStoreLocked = catalog.secret_store?.locked ? 'locked' : 'ready';
      q('providerStatus').setAttribute('data-testid', 'provider-health');
      setStatus(
        'providerStatus',
        `secure store=${catalog.secret_store_path || 'unknown'} (${secretStoreBackend}/${secretStoreLocked}) | scanned=${Number(catalog.scanned_files?.length || 0)} | github_oauth=${authById.github?.cli?.authenticated ? 'active' : 'inactive'}`,
        { toast: false }
      );
      return catalog;
    } catch (err) {
      console.error('refresh_auth_catalog_failed', err);
      setStatus('providerStatus', `catalog failed: ${err.message}`, { type: 'error', title: 'Provider Vault' });
      return null;
    }
  }

  async function refreshRuntime() {
    const c = await jget('/api/config');
    setRuntimeConfigCache(c);
    setSelectByValueOrFirst('autonomyMode', c.runtime?.autonomyMode || 'autonomy-first');
    setSelectByValueOrFirst('shellEnabled', String(Boolean(c.runtime?.shellEnabled)));
    setSelectByValueOrFirst('maxIters', String(c.runtime?.maxToolIterations ?? 8));
    setSelectByValueOrFirst('fallbackEnabled', String(c.model?.routing?.fallbackEnabled !== false));
    const modelProviderIds = getModelProviderIds();
    setFallbackSequence((c.model?.routing?.fallbackProviders || [])
      .filter((provider) => provider && provider !== c.model?.provider)
      .map((provider) => ({
        provider,
        model: stripProviderPrefix(c.model?.providerModels?.[provider], modelProviderIds) || preferredModelForProvider(provider)
      }))
    );
    renderFallbackSequence();
    q('runtimeStatus').textContent =
      `mode=${c.runtime?.autonomyMode || 'autonomy-first'} shell=${c.runtime?.shellEnabled} maxIters=${c.runtime?.maxToolIterations}`;
  }

  async function refreshProviderConfig() {
    const c = await jget('/api/providers/config');
    setSelectByValueOrFirst('ollamaUrl', c.ollamaBaseUrl || 'http://127.0.0.1:11434');
    setSelectByValueOrFirst('openrouterUrl', c.openrouterBaseUrl || 'https://openrouter.ai/api/v1');
    setSelectByValueOrFirst('nvidiaUrl', c.nvidiaBaseUrl || 'https://integrate.api.nvidia.com/v1');
    setSelectByValueOrFirst('xiaomimimoUrl', c.xiaomimimoBaseUrl || 'https://api.x.ai/v1');
    setSelectByValueOrFirst('genericUrl', c.openaiBaseUrl || c.genericBaseUrl || 'https://api.openai.com/v1');
    setRuntimeConfigCache(getRuntimeConfigCache() || await jget('/api/config').catch(() => null));
    await refreshAuthCatalog();
  }

  async function refreshBrowserConfig() {
    const c = await jget('/api/browser/config');
    setSelectByValueOrFirst('cdpPreset', c.cdpUrl || 'http://127.0.0.1:9222');
    const st = await jget('/api/browser/status');
    q('browserStatusLine').textContent = st.ok ? 'connected' : `${st.error}${st.hint ? ' | ' + st.hint : ''}`;
    q('browserHealthValue').textContent = st.ok ? 'Connected' : 'Degraded';
    q('browserHealthMeta').textContent = st.error || st.hint || 'CDP reachable';
    q('browserCdpValue').textContent = c.cdpUrl || 'http://127.0.0.1:9222';
    q('browserTabMeta').textContent = Array.isArray(st.targets) ? `${st.targets.length} visible targets` : 'No live target list';
  }

  async function refreshTelegram() {
    const [cfg, st] = await Promise.all([jget('/api/telegram/config'), jget('/api/telegram/status')]);
    setSelectByValueOrFirst('telegramEnabled', String(Boolean(cfg.enabled)));
    q('tgStatus').textContent = `token=${cfg.hasToken ? 'set' : 'missing'} enabled=${cfg.enabled} running=${st.running}`;
  }

  return {
    refreshCapabilities,
    refreshAuthCatalog,
    refreshRuntime,
    refreshProviderConfig,
    refreshBrowserConfig,
    refreshTelegram
  };
}
