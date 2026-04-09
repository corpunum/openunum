import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { probeCdpEndpoint } from '../../browser/cdp.mjs';

function resolvePlaywrightChromeBin() {
  try {
    const root = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (!fs.existsSync(root)) return null;
    const entries = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
    for (const name of entries) {
      const candidate = path.join(root, name, 'chrome-linux', 'chrome');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {}
  return null;
}

function resolveChromeBin() {
  const override = String(process.env.OPENUNUM_BROWSER_BIN || '').trim();
  if (override && fs.existsSync(override)) return override;
  const playwrightChrome = resolvePlaywrightChromeBin();
  if (playwrightChrome) return playwrightChrome;
  const candidates = ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function createBrowserRuntimeService({
  config,
  saveConfig,
  agent,
  CDPBrowser,
  setBrowser
}) {
  async function ensureBrowserReady() {
    const currentUrl = config.browser?.cdpUrl || 'http://127.0.0.1:9222';
    const probe = await probeCdpEndpoint(currentUrl);
    if (probe.ok) return { ok: true, cdpUrl: currentUrl, source: 'configured' };
    const launched = await launchDebugBrowser();
    if (!launched?.ok) return launched;
    const verify = await probeCdpEndpoint(launched.cdpUrl);
    if (!verify.ok) {
      return {
        ok: false,
        error: 'debug_browser_not_ready',
        hint: verify.hint || 'Launched browser did not expose CDP endpoints.'
      };
    }
    return { ok: true, cdpUrl: launched.cdpUrl, source: 'launched', pid: launched.pid };
  }

  async function launchDebugBrowser() {
    const chromeBin = resolveChromeBin();
    if (!chromeBin) {
      throw new Error('No Chromium/Chrome executable found on host');
    }
    const port = 9333;
    try {
      spawn('pkill', ['-f', 'openunum-chrome-debug'], { stdio: 'ignore' });
    } catch {}

    const args = [
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      '--user-data-dir=/tmp/openunum-chrome-debug',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--headless=new',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-dev-shm-usage',
      '--disable-features=Vulkan,UseSkiaRenderer',
      '--use-gl=swiftshader',
      'about:blank'
    ];
    const child = spawn(chromeBin, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    let ready = false;
    for (let i = 0; i < 20; i += 1) {
      try {
        const probe = await probeCdpEndpoint(`http://127.0.0.1:${port}`);
        if (probe.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!ready) {
      return {
        ok: false,
        error: 'debug_browser_not_ready',
        hint: 'Chromium did not expose CDP on port 9333 after launch.'
      };
    }

    config.browser.cdpUrl = `http://127.0.0.1:${port}`;
    saveConfig(config);
    setBrowser(new CDPBrowser(config.browser.cdpUrl));
    agent.reloadTools();
    return { ok: true, cdpUrl: config.browser.cdpUrl, pid: child.pid };
  }

  return { launchDebugBrowser, ensureBrowserReady };
}
