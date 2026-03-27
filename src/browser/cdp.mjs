export class CDPBrowser {
  constructor(cdpUrl = 'http://127.0.0.1:9222') {
    this.cdpUrl = cdpUrl.replace(/\/$/, '');
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
}
