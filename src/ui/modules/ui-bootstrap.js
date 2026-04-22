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

    // Essential init steps — must run before UI is usable
    const essentialSteps = [
      { name: 'session', fn: () => ensureSessionExists(sessionId) },
      { name: 'capabilities', fn: refreshCapabilities },
      { name: 'model', fn: refreshModel },
      { name: 'sessions', fn: refreshSessionList },
      { name: 'load', fn: loadSession }
    ];

    // Deferred init steps — fetched on demand when settings category is opened
    const deferredSteps = [
      { name: 'runtime', fn: refreshRuntime },
      { name: 'providers', fn: refreshProviderConfig },
      { name: 'tooling', fn: refreshToolingInventory },
      { name: 'overview', fn: refreshRuntimeOverview },
      { name: 'phase0-diag', fn: refreshPhase0Diagnostics },
      { name: 'autonomy-dashboard', fn: refreshAutonomyDashboard },
      { name: 'telegram', fn: refreshTelegram },
      { name: 'mission', fn: refreshMission },
      { name: 'context', fn: refreshContextStatus },
      { name: 'timeline', fn: refreshMissionTimeline }
    ];

    // Store deferred steps globally so settings hub can trigger them
    window.__openunum_deferred_steps = deferredSteps;
    window.__openunum_deferred_loaded = new Set();

    for (const step of essentialSteps) {
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

export async function runDeferredStep(name) {
  const steps = window.__openunum_deferred_steps || [];
  const loaded = window.__openunum_deferred_loaded || new Set();
  const step = steps.find((s) => s.name === name);
  if (!step || loaded.has(name)) return;
  loaded.add(name);
  try {
    await step.fn();
  } catch (e) {
    console.warn(`Deferred step failed: ${name}`, e);
  }
}

export async function runDeferredStepsForCategory(category) {
  const categoryToSteps = {
    'general': [],
    'model-routing': ['runtime', 'model'],
    'provider-vault': ['providers', 'capabilities'],
    'runtime': ['runtime', 'overview', 'phase0-diag', 'autonomy-dashboard', 'context'],
    'tooling': ['tooling'],
    'browser': ['runtime'],
    'channels': ['telegram'],
    'developer': ['mission', 'timeline', 'context']
  };
  const stepNames = categoryToSteps[category] || [];
  for (const name of stepNames) {
    await runDeferredStep(name);
  }
}