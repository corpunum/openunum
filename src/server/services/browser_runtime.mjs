import fs from 'node:fs';
import { spawn } from 'node:child_process';

function resolveChromeBin() {
  const candidates = ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'];
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
      '--user-data-dir=/tmp/openunum-chrome-debug',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--new-window',
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
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
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

  return { launchDebugBrowser };
}

