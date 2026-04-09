import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeCdpEndpoint } from '../../src/browser/cdp.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeCdpEndpoint', () => {
  it('accepts /json/list when /json/version is missing', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).endsWith('/json/version')) {
        return new Response('', { status: 404, headers: { 'Content-Type': 'text/html' } });
      }
      if (String(url).endsWith('/json/list')) {
        return new Response(JSON.stringify([{ id: '1', type: 'page', title: 'x', url: 'about:blank' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('', { status: 404, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await probeCdpEndpoint('http://127.0.0.1:9222');
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('classic-list');
    expect(Array.isArray(out.tabs)).toBe(true);
  });

  it('returns clear hint when all probe endpoints return 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404, headers: { 'Content-Type': 'text/html' } })));
    const out = await probeCdpEndpoint('http://127.0.0.1:9222');
    expect(out.ok).toBe(false);
    expect(out.error).toContain('404');
    expect(String(out.hint || '')).toContain('--remote-debugging-port');
  });
});
