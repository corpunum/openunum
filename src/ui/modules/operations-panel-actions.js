export function createOperationsPanelActions({
  q,
  jpost,
  setStatus,
  setSelectByValueOrFirst,
  refreshBrowserConfig,
  refreshRuntimeOverview,
  refreshTelegram,
  showView
}) {
  function bindOperationsPanelActions() {
    q('saveCdp').onclick = async () => {
      const out = await jpost('/api/browser/config', { cdpUrl: q('cdpPreset').value });
      setStatus('browserStatusLine', `saved ${out.cdpUrl}`, { type: 'success', title: 'Browser CDP' });
      await refreshBrowserConfig();
      await refreshRuntimeOverview();
    };

    q('launchBrowser').onclick = async () => {
      const out = await jpost('/api/browser/ensure', {});
      const okLabel = out.source === 'configured'
        ? `ready at ${out.cdpUrl}`
        : `launched pid=${out.pid} at ${out.cdpUrl}`;
      setStatus('browserStatusLine', out.ok ? okLabel : 'launch failed', {
        type: out.ok ? 'success' : 'error',
        title: 'Browser'
      });
      if (out.cdpUrl) setSelectByValueOrFirst('cdpPreset', out.cdpUrl);
      await refreshBrowserConfig();
      await refreshRuntimeOverview();
    };

    q('navBtn').onclick = async () => {
      const out = await jpost('/api/browser/navigate', { url: q('navUrl').value.trim() });
      q('pcOutput').value = JSON.stringify(out, null, 2);
      showView('operator');
    };

    q('searchBtn').onclick = async () => {
      const out = await jpost('/api/browser/search', { query: q('searchQ').value.trim() });
      q('pcOutput').value = JSON.stringify(out, null, 2);
      showView('operator');
    };

    q('extractBtn').onclick = async () => {
      const out = await jpost('/api/browser/extract', { selector: 'body' });
      q('pcOutput').value = out?.text || JSON.stringify(out, null, 2);
      showView('operator');
    };

    q('saveToken').onclick = async () => {
      await jpost('/api/telegram/config', {
        botToken: q('tgToken').value.trim(),
        enabled: q('telegramEnabled').value === 'true'
      });
      await refreshTelegram();
    };

    q('startTg').onclick = async () => {
      await jpost('/api/telegram/start');
      await refreshTelegram();
    };

    q('stopTg').onclick = async () => {
      await jpost('/api/telegram/stop');
      await refreshTelegram();
    };

    q('tgRefresh').onclick = refreshTelegram;

    q('runShell').onclick = async () => {
      const out = await jpost('/api/tool/run', { name: 'shell_run', args: { cmd: q('shellCmd').value } });
      q('pcOutput').value = JSON.stringify(out.result, null, 2);
    };

    q('openTargetBtn').onclick = async () => {
      const out = await jpost('/api/tool/run', { name: 'desktop_open', args: { target: q('openTarget').value } });
      q('pcOutput').value = JSON.stringify(out.result, null, 2);
    };

    q('runXdotool').onclick = async () => {
      const out = await jpost('/api/tool/run', { name: 'desktop_xdotool', args: { cmd: q('xdotoolCmd').value } });
      q('pcOutput').value = JSON.stringify(out.result, null, 2);
    };
  }

  return {
    bindOperationsPanelActions
  };
}
