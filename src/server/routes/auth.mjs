export async function handleAuthRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/auth/catalog') {
    ctx.sendJson(res, 200, await ctx.buildAuthCatalogPayload(ctx.memoryStore));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/catalog') {
    const body = await ctx.parseBody(req);
    const providerBaseUrls = body?.providerBaseUrls || {};
    const secretUpdates = body?.secrets || {};
    const oauthConfig = body?.oauthConfig || {};
    const clear = Array.isArray(body?.clear) ? body.clear : [];

    if (typeof providerBaseUrls.ollamaBaseUrl === 'string' && providerBaseUrls.ollamaBaseUrl.trim()) ctx.config.model.ollamaBaseUrl = providerBaseUrls.ollamaBaseUrl.trim();
    if (typeof providerBaseUrls.openrouterBaseUrl === 'string' && providerBaseUrls.openrouterBaseUrl.trim()) ctx.config.model.openrouterBaseUrl = providerBaseUrls.openrouterBaseUrl.trim();
    if (typeof providerBaseUrls.nvidiaBaseUrl === 'string' && providerBaseUrls.nvidiaBaseUrl.trim()) ctx.config.model.nvidiaBaseUrl = providerBaseUrls.nvidiaBaseUrl.trim();
    if (typeof providerBaseUrls.xiaomimimoBaseUrl === 'string' && providerBaseUrls.xiaomimimoBaseUrl.trim()) ctx.config.model.xiaomimimoBaseUrl = providerBaseUrls.xiaomimimoBaseUrl.trim();
    if (typeof providerBaseUrls.openaiBaseUrl === 'string' && providerBaseUrls.openaiBaseUrl.trim()) ctx.config.model.openaiBaseUrl = providerBaseUrls.openaiBaseUrl.trim();
    ctx.persistSecretUpdates(secretUpdates, clear);
    if (oauthConfig.googleWorkspace && typeof oauthConfig.googleWorkspace === 'object') {
      ctx.saveGoogleWorkspaceOAuthConfig(ctx.normalizeGoogleWorkspaceOAuthConfig({
        clientId: oauthConfig.googleWorkspace.clientId,
        clientSecret: oauthConfig.googleWorkspace.clientSecret,
        scopes: oauthConfig.googleWorkspace.scopes
      }));
    }
    ctx.saveConfig(ctx.config);
    ctx.agent.reloadTools();

    ctx.sendJson(res, 200, {
      ok: true,
      catalog: await ctx.buildAuthCatalogPayload(ctx.memoryStore)
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/prefill-local') {
    const body = await ctx.parseBody(req);
    const scan = ctx.scanLocalAuthSources();
    const overwriteBaseUrls = body?.overwriteBaseUrls === true;
    ctx.persistSecretUpdates(scan.secrets);
    if (scan.providerBaseUrls.ollamaBaseUrl && (overwriteBaseUrls || !ctx.config.model.ollamaBaseUrl)) ctx.config.model.ollamaBaseUrl = scan.providerBaseUrls.ollamaBaseUrl;
    if (scan.providerBaseUrls.openrouterBaseUrl && (overwriteBaseUrls || !ctx.config.model.openrouterBaseUrl)) ctx.config.model.openrouterBaseUrl = scan.providerBaseUrls.openrouterBaseUrl;
    if (scan.providerBaseUrls.nvidiaBaseUrl && (overwriteBaseUrls || !ctx.config.model.nvidiaBaseUrl)) ctx.config.model.nvidiaBaseUrl = scan.providerBaseUrls.nvidiaBaseUrl;
    if (scan.providerBaseUrls.xiaomimimoBaseUrl && (overwriteBaseUrls || !ctx.config.model.xiaomimimoBaseUrl)) ctx.config.model.xiaomimimoBaseUrl = scan.providerBaseUrls.xiaomimimoBaseUrl;
    if (scan.providerBaseUrls.openaiBaseUrl && (overwriteBaseUrls || !ctx.config.model.openaiBaseUrl)) ctx.config.model.openaiBaseUrl = scan.providerBaseUrls.openaiBaseUrl;
    ctx.saveConfig(ctx.config);
    ctx.agent.reloadTools();
    ctx.sendJson(res, 200, {
      ok: true,
      imported: {
        openrouterApiKey: Boolean(scan.secrets.openrouterApiKey),
        nvidiaApiKey: Boolean(scan.secrets.nvidiaApiKey),
        xiaomimimoApiKey: Boolean(scan.secrets.xiaomimimoApiKey),
        openaiApiKey: Boolean(scan.secrets.openaiApiKey),
        githubToken: Boolean(scan.secrets.githubToken),
        huggingfaceApiKey: Boolean(scan.secrets.huggingfaceApiKey),
        elevenlabsApiKey: Boolean(scan.secrets.elevenlabsApiKey),
        telegramBotToken: Boolean(scan.secrets.telegramBotToken)
      },
      scannedFiles: scan.filesScanned,
      catalog: await ctx.buildAuthCatalogPayload(ctx.memoryStore)
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/provider/test') {
    const body = await ctx.parseBody(req);
    const connection = ctx.providerConnectionOverrides(body.provider, body);
    try {
      ctx.sendJson(res, 200, await ctx.testProviderConnection(connection));
    } catch (error) {
      ctx.sendJson(res, 200, {
        ok: false,
        provider: connection.provider,
        status: 'degraded',
        error: String(error.message || error)
      });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/service/test') {
    const body = await ctx.parseBody(req);
    try {
      ctx.sendJson(res, 200, await ctx.testServiceConnection({
        service: body.service,
        secret: ctx.secretForService(String(body.service || '').trim().toLowerCase(), body.secret)
      }));
    } catch (error) {
      ctx.sendJson(res, 200, {
        ok: false,
        service: String(body.service || '').trim().toLowerCase(),
        status: 'degraded',
        error: String(error.message || error)
      });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/job') {
    const id = String(url.searchParams.get('id') || '').trim();
    const job = ctx.getAuthJob(id);
    if (!job) {
      ctx.sendJson(res, 404, { error: 'auth_job_not_found' });
      return true;
    }
    ctx.sendJson(res, 200, { ok: true, job: ctx.summarizeAuthJob(job) });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/oauth/google-workspace/callback') {
    const state = String(url.searchParams.get('state') || '').trim();
    const code = String(url.searchParams.get('code') || '').trim();
    const error = String(url.searchParams.get('error') || '').trim();
    const errorDescription = String(url.searchParams.get('error_description') || '').trim();
    const job = ctx.findGoogleWorkspaceAuthJobByState(state);
    if (!job) {
      res.writeHead(404, ctx.noCacheHeaders('text/html; charset=utf-8'));
      res.end('<html><body><h1>Google Workspace OAuth</h1><p>Auth job not found.</p></body></html>');
      return true;
    }
    if (error) {
      job.status = 'failed';
      job.error = errorDescription || error;
      job.updatedAt = Date.now();
      res.writeHead(400, ctx.noCacheHeaders('text/html; charset=utf-8'));
      res.end(`<html><body><h1>Google Workspace OAuth</h1><p>${ctx.sanitizeHtml(job.error)}</p></body></html>`);
      return true;
    }
    if (!code) {
      job.status = 'failed';
      job.error = 'google_workspace_code_missing';
      job.updatedAt = Date.now();
      res.writeHead(400, ctx.noCacheHeaders('text/html; charset=utf-8'));
      res.end('<html><body><h1>Google Workspace OAuth</h1><p>Missing authorization code.</p></body></html>');
      return true;
    }
    try {
      await ctx.completeGoogleWorkspaceAuthJob(job, code);
      ctx.agent.reloadTools();
      res.writeHead(200, ctx.noCacheHeaders('text/html; charset=utf-8'));
      res.end('<html><body><h1>Google Workspace OAuth</h1><p>Authentication completed. You can close this window.</p></body></html>');
      return true;
    } catch (callbackError) {
      job.status = 'failed';
      job.error = String(callbackError.message || callbackError);
      job.updatedAt = Date.now();
      res.writeHead(400, ctx.noCacheHeaders('text/html; charset=utf-8'));
      res.end(`<html><body><h1>Google Workspace OAuth</h1><p>${ctx.sanitizeHtml(job.error)}</p></body></html>`);
      return true;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/job/input') {
    const body = await ctx.parseBody(req);
    const out = ctx.completeAuthJob(body?.id, body?.input);
    const code = out.ok ? 200 : 404;
    ctx.sendJson(res, code, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/service/connect') {
    const body = await ctx.parseBody(req);
    const service = String(body?.service || '').trim().toLowerCase();
    if (service === 'openai-oauth') {
      ctx.sendJson(res, 200, await ctx.startOpenAICodexOAuthJob());
      return true;
    }
    if (service === 'google-workspace') {
      ctx.sendJson(res, 200, await ctx.startGoogleWorkspaceOAuthJob());
      return true;
    }
    ctx.sendJson(res, 200, ctx.launchOauthCommand(body.service));
    return true;
  }

  return false;
}
