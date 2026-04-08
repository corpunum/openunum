function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function handleModelRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/model-catalog') {
    ctx.normalizeModelSettings();
    const catalog = await ctx.buildModelCatalog(ctx.config.model, ctx.memoryStore);
    ctx.sendJson(res, 200, catalog);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/models') {
    ctx.normalizeModelSettings();
    const provider = ctx.normalizeProviderId(url.searchParams.get('provider') || ctx.config.model.provider || 'ollama-cloud');
    if (!ctx.PROVIDER_ORDER.includes(provider)) {
      ctx.sendJson(res, 400, { error: `unsupported_provider:${provider}` });
      return true;
    }
    const models = await ctx.buildLegacyProviderModels(ctx.config.model, provider, ctx.memoryStore);
    ctx.sendJson(res, 200, { provider, models });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/model/current') {
    ctx.sendJson(res, 200, ctx.agent.getCurrentModel());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/model/switch') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
      return true;
    }
    const provider = ctx.normalizeProviderId(body.provider);
    const model = String(body.model || '').trim().replace(/^generic\//, 'openai/');
    if (!provider || !model) {
      ctx.sendJson(res, 400, { ok: false, error: 'provider and model are required' });
      return true;
    }
    if (!ctx.PROVIDER_ORDER.includes(provider)) {
      ctx.sendJson(res, 400, { ok: false, error: `unsupported_provider:${provider}` });
      return true;
    }
    const out = ctx.agent.switchModel(
      provider,
      model
    );
    ctx.normalizeModelSettings();
    ctx.saveConfig(ctx.config);
    ctx.sendJson(res, 200, out);
    return true;
  }

  return false;
}
