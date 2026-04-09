function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function handleModelRoute({ req, res, url, ctx }) {
  const done = (status, payload) => {
    ctx.sendJson(res, status, payload);
    return true;
  };

  if (req.method === 'GET' && url.pathname === '/api/model-catalog') {
    ctx.normalizeModelSettings();
    const catalog = await ctx.buildModelCatalog(ctx.config.model, ctx.memoryStore);
    return done(200, catalog);
  }

  if (req.method === 'GET' && url.pathname === '/api/models') {
    ctx.normalizeModelSettings();
    const provider = ctx.normalizeProviderId(url.searchParams.get('provider') || ctx.config.model.provider || 'ollama-cloud');
    if (!ctx.PROVIDER_ORDER.includes(provider)) {
      return done(400, { error: `unsupported_provider:${provider}` });
    }
    const models = await ctx.buildLegacyProviderModels(ctx.config.model, provider, ctx.memoryStore);
    return done(200, { provider, models });
  }

  if (req.method === 'GET' && url.pathname === '/api/models/local/status') {
    return done(200, await ctx.localModelService.getLocalModelStatus());
  }

  if (req.method === 'GET' && url.pathname === '/api/models/local/recommended') {
    return done(200, {
      ok: true,
      models: await ctx.localModelService.getRecommendedStatus()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/models/local/downloads') {
    const limit = Number(url.searchParams.get('limit') || 60);
    return done(200, ctx.localModelService.listDownloads(limit));
  }

  if (req.method === 'GET' && /^\/api\/models\/local\/downloads\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split('/').pop();
    const out = ctx.localModelService.getDownload(id);
    return done(out.ok ? 200 : 404, out);
  }

  if (req.method === 'POST' && /^\/api\/models\/local\/downloads\/[^/]+\/cancel$/.test(url.pathname)) {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const out = ctx.localModelService.cancelDownload(id);
    return done(out.ok ? 200 : 400, out);
  }

  if (req.method === 'POST' && url.pathname === '/api/models/local/download') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      return done(400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
    }
    const out = ctx.localModelService.enqueueDownload({
      model: body.model,
      requestedBy: 'webui'
    });
    return done(out.ok ? 202 : 400, out);
  }

  if (req.method === 'GET' && url.pathname === '/api/model/current') {
    return done(200, ctx.agent.getCurrentModel());
  }

  if (req.method === 'POST' && url.pathname === '/api/model/switch') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      return done(400, { ok: false, error: 'invalid_payload', details: [{ field: 'body', issue: 'expected JSON object' }] });
    }
    const provider = ctx.normalizeProviderId(body.provider);
    const model = String(body.model || '').trim().replace(/^generic\//, 'openai/');
    if (!provider || !model) {
      return done(400, { ok: false, error: 'provider and model are required' });
    }
    if (!ctx.PROVIDER_ORDER.includes(provider)) {
      return done(400, { ok: false, error: `unsupported_provider:${provider}` });
    }
    const out = ctx.agent.switchModel(
      provider,
      model
    );
    ctx.normalizeModelSettings();
    ctx.saveConfig(ctx.config);
    return done(200, out);
  }

  return false;
}
