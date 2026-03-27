import CDP from 'chrome-remote-interface';

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
    try {
      const res = await fetch(`${this.cdpUrl}/json/version`);
      if (!res.ok) {
        if (res.status === 404) {
          return {
            ok: false,
            error: 'CDP endpoint returned 404',
            hint:
              'Port is reachable but not exposing the classic DevTools JSON API. ' +
              'Launch Chrome/Chromium with --remote-debugging-port=9222 (or update cdpUrl in WebUI).'
          };
        }
        return { ok: false, error: `status ${res.status}` };
      }
      const json = await res.json();
      return { ok: true, data: json };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  }

  async listTabs() {
    const res = await fetch(`${this.cdpUrl}/json/list`);
    if (!res.ok) throw new Error(`CDP list failed: ${res.status}`);
    return res.json();
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
