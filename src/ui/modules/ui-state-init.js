export function initializeUiState({
  localStorage,
  q,
  loadDetailPanelState,
  defaultModelProviderIds,
  defaultServiceProviderIds,
  createId = () => crypto.randomUUID()
}) {
  const modelProviderIds = [...defaultModelProviderIds];
  const serviceProviderIds = [...defaultServiceProviderIds];

  const sessionId = localStorage.getItem('openunum_session') || createId();
  const activeMissionId = localStorage.getItem('openunum_mission') || '';
  const lastTaskPrompt = localStorage.getItem('openunum_last_task_prompt') || '';

  let autoEscalateRaw = localStorage.getItem('openunum_auto_escalate');
  if (autoEscalateRaw == null) autoEscalateRaw = 'true';
  const autoEscalateEnabled = autoEscalateRaw === 'true';

  let liveActivityRaw = localStorage.getItem('openunum_live_activity');
  if (liveActivityRaw == null) liveActivityRaw = 'true';
  const liveActivityEnabled = liveActivityRaw === 'true';

  localStorage.setItem('openunum_session', sessionId);
  q('chatMeta').textContent = sessionId;
  q('autoEscalateToggle').textContent = `Auto: ${autoEscalateEnabled ? 'On' : 'Off'}`;
  q('liveActivityToggle').textContent = `Live: ${liveActivityEnabled ? 'On' : 'Off'}`;

  return {
    MODEL_PROVIDER_IDS: modelProviderIds,
    SERVICE_PROVIDER_IDS: serviceProviderIds,
    sessionId,
    activeMissionId,
    lastTaskPrompt,
    autoEscalateEnabled,
    liveActivityEnabled,
    modelCatalog: null,
    authCatalog: null,
    runtimeOverview: null,
    missionTimelineCache: null,
    sessionLoadToken: 0,
    requestTokenSeq: 0,
    pendingSessions: new Set(),
    fallbackSequence: [],
    providerAdvancedOpen: {},
    serviceAdvancedOpen: {},
    runtimeConfigCache: null,
    lastMissionList: [],
    vaultModalState: { kind: '', id: '' },
    hiddenProviderRows: [],
    hiddenServiceRows: [],
    authJobPrompted: {},
    detailPanelState: loadDetailPanelState(localStorage),
    refreshCapabilities: async () => null,
    refreshAuthCatalog: async () => null,
    refreshRuntime: async () => {},
    refreshProviderConfig: async () => {},
    refreshBrowserConfig: async () => {},
    refreshTelegram: async () => {},
    renderProviderSelectors: () => {},
    renderFallbackSequence: () => {},
    closeVaultModal: () => {}
  };
}

