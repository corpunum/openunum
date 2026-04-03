export async function handleModelRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/model-catalog') {
    ctx.normalizeModelSettings();
    const catalog = await ctx.buildModelCatalog(ctx.config.model);
    ctx.sendJson(res, 200, catalog);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/models') {
    ctx.normalizeModelSettings();
    const provider = ctx.normalizeProviderId(url.searchParams.get('provider') || ctx.config.model.provider || 'ollama');
    if (!ctx.PROVIDER_ORDER.includes(provider)) {
      ctx.sendJson(res, 400, { error: `unsupported_provider:${provider}` });
      return true;
    }
    const models = await ctx.buildLegacyProviderModels(ctx.config.model, provider);
    ctx.sendJson(res, 200, { provider, models });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/model/current') {
    ctx.sendJson(res, 200, ctx.agent.getCurrentModel());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/model/switch') {
    const body = await ctx.parseBody(req);
    const out = ctx.agent.switchModel(
      ctx.normalizeProviderId(body.provider),
      String(body.model || '').replace(/^generic\//, 'openai/')
    );
    ctx.normalizeModelSettings();
    ctx.saveConfig(ctx.config);
    ctx.sendJson(res, 200, out);
    return true;
  }

  return false;
}

