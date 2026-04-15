export async function runUiBootstrap(ctx) {
  const {
    q,
    topStatus,
    showView,
    ensureSessionExists,
    sessionId,
    refreshCapabilities,
    refreshModel,
    refreshRuntime,
    refreshProviderConfig,
    refreshToolingInventory,
    refreshRuntimeOverview,
    refreshPhase0Diagnostics,
    refreshAutonomyDashboard,
    refreshTelegram,
    refreshSessionList,
    loadSession,
    refreshMission,
    refreshContextStatus,
    refreshMissionTimeline
  } = ctx;

  try {
    showView('chat');
    if (q('cpPath')) q('cpPath').value = '/api/health';
    if (q('cpBody')) q('cpBody').value = '{\n  "dryRun": true\n}';

    const initSteps = [
      { name: 'session', fn: () => ensureSessionExists(sessionId) },
      { name: 'capabilities', fn: refreshCapabilities },
      { name: 'model', fn: refreshModel },
      { name: 'runtime', fn: refreshRuntime },
      { name: 'providers', fn: refreshProviderConfig },
      { name: 'tooling', fn: refreshToolingInventory },
      { name: 'overview', fn: refreshRuntimeOverview },
      { name: 'phase0-diag', fn: refreshPhase0Diagnostics },
      { name: 'autonomy-dashboard', fn: refreshAutonomyDashboard },
      { name: 'telegram', fn: refreshTelegram },
      { name: 'sessions', fn: refreshSessionList },
      { name: 'load', fn: loadSession },
      { name: 'mission', fn: refreshMission },
      { name: 'context', fn: refreshContextStatus },
      { name: 'timeline', fn: refreshMissionTimeline }
    ];

    for (const step of initSteps) {
      try {
        console.log(`Starting init step: ${step.name}`);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout after 5 seconds')), 5000);
        });
        await Promise.race([step.fn(), timeoutPromise]);
        console.log(`Completed init step: ${step.name}`);
      } catch (e) {
        console.warn(`Init step failed: ${step.name}`, e);
        topStatus.textContent = `init step failed: ${step.name} (${String(e.message || e)})`;
      }
    }

    if (topStatus.textContent === 'booting...') {
      topStatus.textContent = 'ready';
    } else if (topStatus.textContent.includes('init failed')) {
      topStatus.textContent += ' (but continuing with limited functionality)';
    }
  } catch (error) {
    const msg = String(error?.message || error);
    console.error('openunum_ui_init_failed', error);
    topStatus.textContent = `init failed: ${msg}`;
    const providerStatus = q('providerStatus');
    if (providerStatus) providerStatus.textContent = `ui init failed: ${msg}`;
  }
}

