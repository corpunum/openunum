function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function handleBrowserRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/browser/status') {
    const out = await ctx.getBrowser().status();
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/browser/navigate') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const targetUrl = String(body.url || '').trim();
    if (!targetUrl) {
      ctx.sendJson(res, 400, { ok: false, error: 'url_required' });
      return true;
    }
    ctx.sendJson(res, 200, await ctx.getBrowser().navigate(targetUrl));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/browser/search') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    const query = String(body.query || '').trim();
    if (!query) {
      ctx.sendJson(res, 400, { ok: false, error: 'query_required' });
      return true;
    }
    ctx.sendJson(res, 200, await ctx.getBrowser().search(query));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/browser/extract') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    ctx.sendJson(res, 200, await ctx.getBrowser().extractText(body.selector || 'body'));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/browser/config') {
    ctx.sendJson(res, 200, { cdpUrl: ctx.config.browser?.cdpUrl || 'http://127.0.0.1:9222' });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/browser/config') {
    const body = await ctx.parseBody(req);
    if (!isPlainObject(body)) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_payload' });
      return true;
    }
    if (!ctx.config.browser) ctx.config.browser = {};
    if (typeof body.cdpUrl === 'string' && body.cdpUrl.trim()) {
      ctx.config.browser.cdpUrl = body.cdpUrl.trim();
    }
    ctx.saveConfig(ctx.config);
    ctx.setBrowser(new ctx.CDPBrowser(ctx.config.browser.cdpUrl));
    ctx.agent.reloadTools();
    ctx.sendJson(res, 200, { ok: true, cdpUrl: ctx.config.browser.cdpUrl });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/browser/launch') {
    const out = await ctx.launchDebugBrowser();
    ctx.sendJson(res, 200, out);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/browser/ensure') {
    const out = await ctx.ensureBrowserReady();
    ctx.sendJson(res, out.ok ? 200 : 503, out);
    return true;
  }

  return false;
}
