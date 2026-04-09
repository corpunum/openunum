import CDP from 'chrome-remote-interface';

const DEFAULT_CDP_TIMEOUT_MS = 2500;

async function fetchWithTimeout(url, timeoutMs = DEFAULT_CDP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryJsonEndpoint(baseUrl, path, timeoutMs = DEFAULT_CDP_TIMEOUT_MS) {
  const res = await fetchWithTimeout(`${baseUrl}${path}`, timeoutMs);
  if (!res.ok) {
    return { ok: false, path, status: res.status };
  }
  try {
    const data = await res.json();
    return { ok: true, path, status: res.status, data };
  } catch {
    return { ok: false, path, status: res.status, error: 'invalid_json' };
  }
}

export async function probeCdpEndpoint(cdpUrl, { timeoutMs = DEFAULT_CDP_TIMEOUT_MS } = {}) {
  const baseUrl = String(cdpUrl || 'http://127.0.0.1:9222').replace(/\/$/, '');
  const attempts = [];
  const paths = ['/json/version', '/json/list', '/json'];
  for (const path of paths) {
    try {
      const out = await tryJsonEndpoint(baseUrl, path, timeoutMs);
      attempts.push(out);
      if (!out.ok) continue;
      if (path === '/json/version' && out.data && typeof out.data === 'object') {
        return {
          ok: true,
          mode: 'classic-version',
          cdpUrl: baseUrl,
          version: out.data,
          attempts
        };
      }
      if ((path === '/json/list' || path === '/json') && Array.isArray(out.data)) {
        return {
          ok: true,
          mode: path === '/json/list' ? 'classic-list' : 'classic-json',
          cdpUrl: baseUrl,
          tabs: out.data,
          attempts
        };
      }
    } catch (error) {
      attempts.push({ ok: false, path, error: String(error?.message || error) });
    }
  }

  const all404 = attempts.length > 0 && attempts.every((a) => a.ok === false && a.status === 404);
  if (all404) {
    return {
      ok: false,
      cdpUrl: baseUrl,
      error: 'CDP endpoint returned 404',
      hint:
        'Port is reachable but not exposing DevTools JSON endpoints. ' +
        'Start Chromium with --remote-debugging-port=<port> and a separate --user-data-dir.',
      attempts
    };
  }
  return {
    ok: false,
    cdpUrl: baseUrl,
    error: 'CDP probe failed',
    hint: 'Could not reach DevTools JSON endpoints. Check cdpUrl, browser launch flags, and local firewall.',
    attempts
  };
}

export class CDPBrowser {
  constructor(cdpUrl = 'http://127.0.0.1:9222') {
    this.cdpUrl = cdpUrl.replace(/\/$/, '');
  }

  parseHostPort() {
    const u = new URL(this.cdpUrl);
    return {
      host: u.hostname,
      port: Number(u.port || 80)
    };
  }

  async status() {
    const out = await probeCdpEndpoint(this.cdpUrl);
    if (!out.ok) return out;
    return {
      ok: true,
      cdpUrl: out.cdpUrl,
      mode: out.mode,
      data: out.version || null,
      targets: Array.isArray(out.tabs) ? out.tabs.length : undefined
    };
  }

  async listTabs() {
    const probe = await probeCdpEndpoint(this.cdpUrl);
    if (!probe.ok) throw new Error(probe.error || 'CDP unavailable');
    if (Array.isArray(probe.tabs)) return probe.tabs;
    const res = await fetchWithTimeout(`${this.cdpUrl}/json/list`);
    if (res.ok) return res.json();
    const fallbackRes = await fetchWithTimeout(`${this.cdpUrl}/json`);
    if (fallbackRes.ok) return fallbackRes.json();
    throw new Error(`CDP list failed: ${res.status}/${fallbackRes.status}`);
  }

  async resolvePageTarget() {
    const tabs = await this.listTabs();
    let page = tabs.find((t) => t.type === 'page');
    if (!page) {
      page = await this.open('about:blank');
    }
    return page;
  }

  async withPageClient(fn) {
    const page = await this.resolvePageTarget();
    const { host, port } = this.parseHostPort();
    const client = await CDP({
      host,
      port,
      target: page
    });
    try {
      return await fn(client);
    } finally {
      await client.close();
    }
  }

  async open(url) {
    const encoded = encodeURIComponent(url);
    let res = await fetch(`${this.cdpUrl}/json/new?${encoded}`, { method: 'PUT' });
    if (!res.ok) {
      res = await fetch(`${this.cdpUrl}/json/new?${encoded}`);
    }
    if (!res.ok) throw new Error(`CDP open failed: ${res.status}`);
    return res.json();
  }

  async snapshot() {
    const tabs = await this.listTabs();
    const first = tabs.find((t) => t.type === 'page') || tabs[0] || null;
    if (!first) return { tabs: [], active: null };
    return {
      tabs,
      active: {
        id: first.id,
        title: first.title,
        url: first.url,
        type: first.type
      }
    };
  }

  async navigate(url) {
    return this.withPageClient(async (client) => {
      const { Page } = client;
      await Page.enable();
      await Page.navigate({ url });
      await Page.loadEventFired();
      return { ok: true, url };
    });
  }

  async search(query) {
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    await this.navigate(url);
    return this.extractText('body');
  }

  async evaluate(expression) {
    return this.withPageClient(async (client) => {
      const { Runtime } = client;
      await Runtime.enable();
      const out = await Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      return out.result?.value;
    });
  }

  async click(selector) {
    const expr = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok:false, error:'not_found' };
        el.click();
        return { ok:true };
      })()
    `;
    return this.evaluate(expr);
  }

  async type(selector, text, submit = false) {
    const expr = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok:false, error:'not_found' };
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (${submit ? 'true' : 'false'}) {
          const form = el.closest('form');
          if (form) form.submit();
          else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
        return { ok:true };
      })()
    `;
    return this.evaluate(expr);
  }

  async extractText(selector = 'body') {
    const expr = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok:false, error:'not_found' };
        const text = (el.innerText || '').slice(0, 12000);
        return { ok:true, text };
      })()
    `;
    return this.evaluate(expr);
  }

  async screenshot() {
    return this.withPageClient(async (client) => {
      const { Page } = client;
      await Page.enable();
      const out = await Page.captureScreenshot({ format: 'png', fromSurface: true });
      return { ok: true, pngBase64: out.data };
    });
  }
}
