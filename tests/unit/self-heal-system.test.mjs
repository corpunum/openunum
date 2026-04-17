import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelfHealSystem } from '../../src/core/self-heal.mjs';

describe('SelfHealSystem', () => {
  const originalHome = process.env.OPENUNUM_HOME;
  const originalFetch = globalThis.fetch;
  let tempHome;
  let fetchMock;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-self-heal-'));
    process.env.OPENUNUM_HOME = tempHome;
    fs.writeFileSync(path.join(tempHome, 'openunum.db'), 'ok');
    fetchMock = vi.fn(async (url) => {
      const text = String(url);
      if (text.endsWith('/api/tags')) {
        return { ok: true, status: 200 };
      }
      if (text.includes('/json/')) {
        return { ok: false, status: 404 };
      }
      throw new Error(`unexpected_fetch:${text}`);
    });
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.OPENUNUM_HOME;
    else process.env.OPENUNUM_HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('uses the injected server probe without recursively calling /api/health', async () => {
    const system = new SelfHealSystem({
      config: {
        server: { host: '127.0.0.1', port: 18880 },
        model: { ollamaBaseUrl: 'http://127.0.0.1:11434' },
        browser: { cdpUrl: 'http://127.0.0.1:9333' }
      },
      agent: null,
      memoryStore: null,
      probes: {
        serverResponsive: async () => ({ ok: true, source: 'test-probe' })
      }
    });
    system.runShell = vi.fn()
      .mockResolvedValueOnce({ stdout: 'tmpfs 100G 10G 90G 10% /home' })
      .mockResolvedValueOnce({ stdout: '2048\n' });

    const out = await system.runHealthCheck();

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/health'))).toBe(false);
    expect(out.checks.some((check) => check.name === 'server_responsive' && check.ok)).toBe(true);
  });
});
