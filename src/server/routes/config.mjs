import { validateConfigPatch, validateProvidersConfigPatch } from '../contracts/request-contracts.mjs';

export async function handleConfigRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    ctx.reloadConfigSecrets();
    ctx.normalizeModelSettings();
    const catalog = await ctx.buildModelCatalog(ctx.config.model);
    const sanitized = ctx.scrubSecretsFromConfig(ctx.config);
    ctx.sendJson(res, 200, {
      model: sanitized.model,
      runtime: sanitized.runtime,
      research: sanitized.research,
      integrations: sanitized.integrations,
      browser: sanitized.browser,
      channels: { telegram: { enabled: Boolean(ctx.config.channels?.telegram?.enabled), hasToken: Boolean(ctx.config.channels?.telegram?.botToken) } },
      capabilities: ctx.buildCapabilitiesPayload(),
      modelCatalog: catalog,
      providerConfig: ctx.getProviderConfigPayload(),
      authCatalog: await ctx.buildAuthCatalogPayload()
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/config') {
    const body = await ctx.parseBody(req);
    const validation = validateConfigPatch(body, { normalizeProviderId: ctx.normalizeProviderId });
    if (!validation.ok) {
      ctx.sendJson(res, 400, {
        ok: false,
        error: 'invalid_payload',
        details: validation.errors
      });
      return true;
    }

    ctx.applyConfigPatch(validation.value, { normalizeProviderId: ctx.normalizeProviderId });
    ctx.normalizeModelSettings();
    ctx.saveConfig(ctx.config);
    ctx.agent.reloadTools();
    if (ctx.config.runtime.researchDailyEnabled) ctx.startResearchDailyLoop();
    else ctx.stopResearchDailyLoop();

    ctx.sendJson(res, 200, { ok: true, runtime: ctx.config.runtime });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/providers/config') {
    ctx.reloadConfigSecrets();
    ctx.normalizeModelSettings();
    ctx.sendJson(res, 200, ctx.getProviderConfigPayload());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/providers/config') {
    const body = await ctx.parseBody(req);
    const validation = validateProvidersConfigPatch(body);
    if (!validation.ok) {
      ctx.sendJson(res, 400, {
        ok: false,
        error: 'invalid_payload',
        details: validation.errors
      });
      return true;
    }

    ctx.applyProvidersConfigPatch(validation.value);
    ctx.normalizeModelSettings();
    ctx.saveConfig(ctx.config);
    ctx.agent.reloadTools();
    ctx.sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/providers/import-openclaw') {
    const imported = ctx.importProviderSecretsFromOpenClaw();
    ctx.persistSecretUpdates({
      openrouterApiKey: imported.openrouterApiKey || '',
      nvidiaApiKey: imported.nvidiaApiKey || '',
      xiaomimimoApiKey: imported.xiaomimimoApiKey || '',
      openaiApiKey: imported.openaiApiKey || '',
      githubToken: imported.githubToken || '',
      huggingfaceApiKey: imported.huggingfaceApiKey || '',
      elevenlabsApiKey: imported.elevenlabsApiKey || '',
      telegramBotToken: imported.telegramBotToken || ''
    });
    if (imported.openrouterBaseUrl) ctx.config.model.openrouterBaseUrl = imported.openrouterBaseUrl;
    if (imported.nvidiaBaseUrl) ctx.config.model.nvidiaBaseUrl = imported.nvidiaBaseUrl;
    if (imported.xiaomimimoBaseUrl) ctx.config.model.xiaomimimoBaseUrl = imported.xiaomimimoBaseUrl;
    if (imported.openaiBaseUrl) ctx.config.model.openaiBaseUrl = imported.openaiBaseUrl;
    if (imported.ollamaBaseUrl) ctx.config.model.ollamaBaseUrl = imported.ollamaBaseUrl;
    ctx.normalizeModelSettings();
    ctx.saveConfig(ctx.config);
    ctx.agent.reloadTools();
    ctx.sendJson(res, 200, {
      ok: true,
      imported: {
        openrouterApiKey: Boolean(imported.openrouterApiKey),
        nvidiaApiKey: Boolean(imported.nvidiaApiKey),
        xiaomimimoApiKey: Boolean(imported.xiaomimimoApiKey),
        openaiApiKey: Boolean(imported.openaiApiKey),
        githubToken: Boolean(imported.githubToken),
        huggingfaceApiKey: Boolean(imported.huggingfaceApiKey),
        elevenlabsApiKey: Boolean(imported.elevenlabsApiKey),
        telegramBotToken: Boolean(imported.telegramBotToken),
        openrouterBaseUrl: imported.openrouterBaseUrl || ctx.config.model.openrouterBaseUrl,
        nvidiaBaseUrl: imported.nvidiaBaseUrl || ctx.config.model.nvidiaBaseUrl,
        xiaomimimoBaseUrl: imported.xiaomimimoBaseUrl || ctx.config.model.xiaomimimoBaseUrl,
        openaiBaseUrl: imported.openaiBaseUrl || ctx.config.model.openaiBaseUrl,
        ollamaBaseUrl: imported.ollamaBaseUrl || ctx.config.model.ollamaBaseUrl
      }
    });
    return true;
  }

  return false;
}
