import { q, qa, escapeHtml, sleep } from './modules/dom.js';
import { jget, jpost, jrequest } from './modules/http.js';
import { setStatus } from './modules/feedback.js';
import { showView as showViewWithMeta } from './modules/navigation.js';
import { normalizeServiceCapabilityIds } from './modules/capabilities.js';
import {
  renderStatusBadge,
  providerSummaryText,
  serviceSummaryText
} from './modules/provider-vault.js';
import {
  buildProviderAuthCatalogPayload,
  buildProviderTestRequest,
  buildServiceSavePayload,
  buildServiceTestRequest,
  formatProviderTestStatus,
  formatServiceTestStatus
} from './modules/provider-actions.js';
import {
  bindControlPlaneStaticActions,
  buildResearchApproveBody,
  buildModelScoutRunBody,
  buildTaskRunBody,
  parseControlPlaneBody
} from './modules/control-plane.js';
import {
  buildClearAllSessionsPayload,
  buildSessionExportFilename,
  buildSessionExportStatus,
  buildSessionImportRequest,
  buildSessionImportStatus,
  buildMissionCloneStatus
} from './modules/session-io.js';
import {
  providerChoicesForFallbackRow,
  canAddFallbackProvider,
  autoFillFallbackSequence,
  computeOnlineFallbackSequence,
  buildProviderModelsPatch
} from './modules/model-routing.js';
import { createProviderVaultHelpers } from './modules/provider-vault-helpers.js';
import { createWebuiWireValidator } from './modules/wire-validation.js';
import { createProviderVaultActions } from './modules/provider-vault-actions.js';
import { createProviderVaultRenderers } from './modules/provider-vault-renderers.js';
import { createRuntimePanelsController } from './modules/runtime-panels.js';
import { createModelCatalogController } from './modules/model-catalog-controller.js';
import { createMissionsUiController } from './modules/missions-ui-controller.js';
import { createControlPlaneController } from './modules/control-plane-controller.js';
import { createOperationsPanelActions } from './modules/operations-panel-actions.js';
import { createSessionController } from './modules/session-controller.js';
import { createChatComposerController } from './modules/chat-composer-controller.js';
import { createChatPendingController } from './modules/chat-pending-controller.js';
import { createSettingsActionsController } from './modules/settings-actions-controller.js';
import { createSettingsToolingController } from './modules/settings-tooling-controller.js';
import { createUiShellActions } from './modules/ui-shell-actions.js';
import { createAutoMissionRunner } from './modules/chat-auto-mission.js';
import { createRuntimeRefreshers } from './modules/runtime-refreshers.js';
import {
  setSelectByValueOrFirst as setSelectByValueOrFirstWithQ,
  createRoutingUiHelpers
} from './modules/routing-ui-helpers.js';
import { closeVaultModal as closeVaultModalWithState } from './modules/vault-modal.js';
import {
  createPendingTelemetry,
  markPendingTelemetryActivity,
  markPendingTelemetryCleared,
  markPendingTelemetryFinal,
  summarizePendingTelemetry,
  formatPendingTelemetrySummary
} from './modules/pending-telemetry.js';
import { buildRuntimeOverviewView } from './modules/runtime-overview.js';
import { buildMissionTimelineView } from './modules/missions.js';
import {
  loadDetailPanelState,
  detailPanelKey,
  rememberDetailPanelState as rememberDetailPanelStateWithStorage,
  bindPersistentDetailPanels
} from './modules/detail-panels.js';
import { createChatRenderer } from './modules/chat-render.js';
import {
  pendingPollDelayMs,
  chatFastAckTimeoutMs,
  formatRelativeTime,
  newestAssistantSince,
  buildPendingStatus,
  shouldEscalateToAuto,
  isStatusCheckMessage,
  isPlanningReply,
  formatProviderModel,
  stripProviderPrefix
} from './modules/logic.js';

const VIEW_META = {
  chat: ['Chat Terminal', 'Autonomous agent conversation'],
  'operator': ['Execution Trace', 'Runtime, tools, and live execution state'],
  'model-routing': ['Model Routing', 'Primary model selection and fallback strategy'],
  'provider-config': ['Provider Vault', 'Provider matrix, models, and secure auth vault'],
  'settings-tooling': ['Tooling and Skills', 'Agent tools, skills inventory, and model-backed rollout'],
  'browser': ['Browser Ops', 'Browser and hardware control'],
  'telegram': ['Telegram Bridge', 'Channel connectivity and polling control'],
  'missions': ['Mission Runner', 'Autonomous execution loops'],
  'control-plane': ['Control Plane API', 'Backend operations and full API access']
};

let MODEL_PROVIDER_IDS = ['ollama-local', 'ollama-cloud', 'nvidia', 'openrouter', 'xiaomimimo', 'openai'];
let SERVICE_PROVIDER_IDS = ['github', 'google-workspace', 'huggingface', 'elevenlabs', 'telegram', 'openai-oauth', 'github-copilot'];
const SERVICE_SECRET_FIELD = {
  github: 'githubToken',
  'google-workspace': '',
  huggingface: 'huggingfaceApiKey',
  elevenlabs: 'elevenlabsApiKey',
  telegram: 'telegramBotToken',
  'openai-oauth': 'openaiOauthToken',
  'github-copilot': 'copilotGithubToken'
};
const PROVIDER_SECRET_FIELD = {
  'ollama-local': '',
  'ollama-cloud': '',
  nvidia: 'nvidiaApiKey',
  openrouter: 'openrouterApiKey',
  xiaomimimo: 'xiaomimimoApiKey',
  openai: 'openaiApiKey'
};
const PROVIDER_BASE_FIELD = {
  'ollama-local': 'ollamaBaseUrl',
  'ollama-cloud': 'ollamaBaseUrl',
  nvidia: 'nvidiaBaseUrl',
  openrouter: 'openrouterBaseUrl',
  xiaomimimo: 'xiaomimimoBaseUrl',
  openai: 'openaiBaseUrl'
};

let sessionId = localStorage.getItem('openunum_session') || crypto.randomUUID();
let activeMissionId = localStorage.getItem('openunum_mission') || '';
let lastTaskPrompt = localStorage.getItem('openunum_last_task_prompt') || '';
let autoEscalateEnabled = localStorage.getItem('openunum_auto_escalate');
if (autoEscalateEnabled == null) autoEscalateEnabled = 'true';
autoEscalateEnabled = autoEscalateEnabled === 'true';
let liveActivityEnabled = localStorage.getItem('openunum_live_activity');
if (liveActivityEnabled == null) liveActivityEnabled = 'true';
liveActivityEnabled = liveActivityEnabled === 'true';
localStorage.setItem('openunum_session', sessionId);

const topStatus = q('topStatus');
const chat = q('chat');
const sessionListEl = q('sessionList');
let modelCatalog = null;
let authCatalog = null;
let runtimeOverview = null;
let missionTimelineCache = null;
let sessionLoadToken = 0;
let requestTokenSeq = 0;
const pendingSessions = new Set();
let fallbackSequence = [];
let providerAdvancedOpen = {};
let serviceAdvancedOpen = {};
let runtimeConfigCache = null;
let lastMissionList = [];
const vaultModalState = { kind: '', id: '' };
let hiddenProviderRows = [];
let hiddenServiceRows = [];
let authJobPrompted = {};
let detailPanelState = loadDetailPanelState(localStorage);
let refreshCapabilities = async () => null;
let refreshAuthCatalog = async () => null;
let refreshRuntime = async () => {};
let refreshProviderConfig = async () => {};
let refreshBrowserConfig = async () => {};
let refreshTelegram = async () => {};
let renderProviderSelectors = () => {};
let renderFallbackSequence = () => {};
let closeVaultModal = () => {};
q('chatMeta').textContent = sessionId;
q('autoEscalateToggle').textContent = `Auto: ${autoEscalateEnabled ? 'On' : 'Off'}`;
q('liveActivityToggle').textContent = `Live: ${liveActivityEnabled ? 'On' : 'Off'}`;
function isCurrentSessionPending() {
  return pendingSessions.has(sessionId);
}
function updateComposerPendingState() {
  const pending = isCurrentSessionPending();
  q('send').disabled = pending;
  q('message').placeholder = pending
    ? 'Session is still running. Switch sessions or wait for completion.'
    : 'Type a message. Enter sends, Shift+Enter adds a new line';
}
function rememberDetailPanelState(key, patch) {
  rememberDetailPanelStateWithStorage(detailPanelState, key, patch, localStorage);
}

function showView(viewId) {
  showViewWithMeta(viewId, VIEW_META);
}

const chatRenderer = createChatRenderer({
  chat,
  escapeHtml,
  bindPersistentDetailPanels,
  detailPanelKey,
  getDetailPanelState: () => detailPanelState,
  rememberDetailPanelState,
  getSessionId: () => sessionId
});
const {
  pushMsg,
  appendTypingBubble,
  addLiveEvent,
  renderLiveBubble,
  renderTrace
} = chatRenderer;
const providerVaultHelpers = createProviderVaultHelpers({
  q,
  localStorage,
  escapeHtml,
  getModelProviderIds: () => MODEL_PROVIDER_IDS,
  getServiceProviderIds: () => SERVICE_PROVIDER_IDS,
  getAuthCatalog: () => authCatalog,
  getModelCatalog: () => modelCatalog,
  getRuntimeOverview: () => runtimeOverview,
  getHiddenProviderRows: () => hiddenProviderRows,
  setHiddenProviderRows: (value) => { hiddenProviderRows = value; },
  getHiddenServiceRows: () => hiddenServiceRows,
  setHiddenServiceRows: (value) => { hiddenServiceRows = value; },
  getFallbackSequence: () => fallbackSequence,
  setFallbackSequence: (value) => { fallbackSequence = value; }
});
const {
  formatPct,
  knownProviderRowIds,
  knownServiceRowIds,
  normalizeHiddenRows,
  providerCatalogRow,
  catalogModelsForProvider,
  preferredModelForProvider,
  ensureFallbackSequence,
  buildFallbackModelOptions,
  refreshAddRowSelectors,
  authMethodById
} = providerVaultHelpers;
const modelCatalogController = createModelCatalogController({
  q,
  jget,
  escapeHtml,
  stripProviderPrefix,
  setSelectByValueOrFirst,
  topStatus,
  formatProviderModel,
  getModelProviderIds: () => MODEL_PROVIDER_IDS,
  getModelCatalog: () => modelCatalog,
  setModelCatalog: (value) => { modelCatalog = value; },
  getRuntimeConfigCache: () => runtimeConfigCache,
  setRuntimeConfigCache: (value) => { runtimeConfigCache = value; },
  renderProviderSelectors,
  renderFallbackSequence
});
const {
  refreshModel,
  refreshModelCatalog,
  renderProviderCards,
  loadModelsForProvider
} = modelCatalogController;
let runtimePanelsController = null;
const runWebuiWireValidation = createWebuiWireValidator({
  setStatus,
  getRuntimeConfigCache: async () => runtimeConfigCache || await jget('/api/config'),
  setRuntimeConfigCache: (value) => { runtimeConfigCache = value; },
  refreshModelCatalog,
  refreshAuthCatalog,
  refreshRuntimeOverview: async () => runtimePanelsController?.refreshRuntimeOverview?.()
});
const providerVaultActions = createProviderVaultActions({
  q,
  escapeHtml,
  setStatus,
  jpost,
  jget,
  providerCatalogRow,
  getAuthCatalog: () => authCatalog,
  runWebuiWireValidation,
  refreshProviderConfig,
  refreshModelCatalog,
  refreshRuntimeOverview: async () => runtimePanelsController?.refreshRuntimeOverview?.(),
  buildProviderAuthCatalogPayload,
  buildProviderTestRequest,
  buildServiceSavePayload,
  buildServiceTestRequest,
  formatProviderTestStatus,
  formatServiceTestStatus,
  PROVIDER_SECRET_FIELD,
  PROVIDER_BASE_FIELD,
  SERVICE_SECRET_FIELD,
  vaultModalState,
  authJobPrompted,
  closeVaultModal: () => closeVaultModal(),
  onAuthCatalogRefresh: async () => refreshAuthCatalog()
});
const {
  openVaultModal,
  saveVaultModal,
  testVaultModal,
  saveProviderRow,
  testProviderRow,
  saveServiceRow,
  testServiceRow,
  connectServiceRow
} = providerVaultActions;
const providerVaultRenderers = createProviderVaultRenderers({
  q,
  qa,
  jget,
  jpost,
  escapeHtml,
  renderStatusBadge,
  providerSummaryText,
  serviceSummaryText,
  setStatus,
  openVaultModal,
  saveProviderRow,
  testProviderRow,
  saveServiceRow,
  testServiceRow,
  connectServiceRow,
  setSelectByValueOrFirst,
  loadModelsForProvider,
  showView,
  stripProviderPrefix,
  runWebuiWireValidation,
  refreshRuntime,
  refreshProviderConfig,
  refreshModelCatalog,
  refreshRuntimeOverview: async () => runtimePanelsController?.refreshRuntimeOverview?.(),
  normalizeHiddenRows,
  refreshAddRowSelectors,
  getAuthCatalog: () => authCatalog,
  getRuntimeConfigCache: () => runtimeConfigCache,
  setRuntimeConfigCache: (value) => { runtimeConfigCache = value; },
  getModelProviderIds: () => MODEL_PROVIDER_IDS,
  getProviderSecretField: () => PROVIDER_SECRET_FIELD,
  getServiceSecretField: () => SERVICE_SECRET_FIELD,
  getHiddenProviderRows: () => hiddenProviderRows,
  setHiddenProviderRows: (value) => { hiddenProviderRows = value; },
  getHiddenServiceRows: () => hiddenServiceRows,
  setHiddenServiceRows: (value) => { hiddenServiceRows = value; },
  getProviderAdvancedOpen: () => providerAdvancedOpen,
  getServiceAdvancedOpen: () => serviceAdvancedOpen
});
const { renderProviderMatrix, renderAuthMethodTable } = providerVaultRenderers;
runtimePanelsController = createRuntimePanelsController({
  q,
  jget,
  escapeHtml,
  showView,
  buildRuntimeOverviewView,
  buildMissionTimelineView,
  formatPct,
  getSessionId: () => sessionId,
  getActiveMissionId: () => activeMissionId,
  getMissionTimelineCache: () => missionTimelineCache,
  setMissionTimelineCache: (value) => { missionTimelineCache = value; },
  setRuntimeOverview: (value) => { runtimeOverview = value; }
});
const {
  refreshRuntimeOverview,
  refreshPhase0DiagnosticsLocal: refreshPhase0Diagnostics,
  refreshContextStatusLocal: refreshContextStatus,
  refreshTacticalLedger,
  refreshMissionTimeline,
  renderMissionTimeline
} = runtimePanelsController;
let resumePendingSessionIfNeeded = async () => false;
const sessionController = createSessionController({
  q,
  jget,
  jpost,
  jrequest,
  escapeHtml,
  formatRelativeTime,
  localStorage,
  chat,
  sessionListEl,
  showView,
  updateComposerPendingState,
  refreshContextStatus,
  refreshTacticalLedger,
  pushMsg,
  getSessionId: () => sessionId,
  setSessionId: (value) => { sessionId = value; },
  getSessionLoadToken: () => sessionLoadToken,
  setSessionLoadToken: (value) => { sessionLoadToken = value; },
  resumePendingSessionIfNeeded: (sid) => resumePendingSessionIfNeeded(sid)
});
const {
  getSessionCache,
  refreshSessionList,
  ensureSessionExists,
  switchToSession,
  loadSession,
  resetSession,
  bindSessionSearch
} = sessionController;
const chatPendingController = createChatPendingController({
  jget,
  sleep,
  pendingPollDelayMs,
  createPendingTelemetry,
  markPendingTelemetryActivity,
  markPendingTelemetryCleared,
  markPendingTelemetryFinal,
  summarizePendingTelemetry,
  formatPendingTelemetrySummary,
  newestAssistantSince,
  buildPendingStatus,
  escapeHtml,
  appendTypingBubble,
  addLiveEvent,
  renderLiveBubble,
  refreshSessionList,
  loadSession,
  updateComposerPendingState,
  isLiveActivityEnabled: () => liveActivityEnabled,
  getSessionId: () => sessionId,
  isRequestTokenCurrent: (token) => token === requestTokenSeq,
  nextRequestToken: () => ++requestTokenSeq,
  addPendingSession: (sid) => pendingSessions.add(sid),
  removePendingSession: (sid) => pendingSessions.delete(sid)
});
const { resolvePendingReply } = chatPendingController;
resumePendingSessionIfNeeded = chatPendingController.resumePendingSessionIfNeeded;
bindSessionSearch();

const autoMissionRunner = createAutoMissionRunner({
  q,
  jpost,
  jget,
  sleep,
  addLiveEvent,
  renderLiveBubble,
  escapeHtml,
  getLocationOrigin: () => location.origin
});
const { runAutoMissionFromChat } = autoMissionRunner;


function setSelectByValueOrFirst(id, value) {
  setSelectByValueOrFirstWithQ(q, id, value);
}

const routingUiHelpers = createRoutingUiHelpers({
  q,
  qa,
  getModelProviderIds: () => MODEL_PROVIDER_IDS,
  getFallbackSequence: () => fallbackSequence,
  setFallbackSequence: (value) => { fallbackSequence = value; },
  ensureFallbackSequence,
  preferredModelForProvider,
  providerChoicesForFallbackRow,
  buildFallbackModelOptions,
  setSelectByValueOrFirstFn: (id, value) => setSelectByValueOrFirst(id, value)
});
({ renderProviderSelectors, renderFallbackSequence } = routingUiHelpers);

closeVaultModal = () => closeVaultModalWithState(q, vaultModalState);
const runtimeRefreshers = createRuntimeRefreshers({
  q,
  jget,
  setStatus,
  normalizeServiceCapabilityIds,
  stripProviderPrefix,
  preferredModelForProvider,
  setSelectByValueOrFirst,
  renderProviderSelectors,
  renderFallbackSequence,
  normalizeHiddenRows,
  refreshAddRowSelectors,
  renderProviderMatrix,
  renderAuthMethodTable,
  getModelProviderIds: () => MODEL_PROVIDER_IDS,
  setModelProviderIds: (value) => { MODEL_PROVIDER_IDS = value; },
  setServiceProviderIds: (value) => { SERVICE_PROVIDER_IDS = value; },
  getRuntimeConfigCache: () => runtimeConfigCache,
  setRuntimeConfigCache: (value) => { runtimeConfigCache = value; },
  setAuthCatalog: (value) => { authCatalog = value; },
  getFallbackSequence: () => fallbackSequence,
  setFallbackSequence: (value) => { fallbackSequence = value; },
  getServiceSecretField: () => SERVICE_SECRET_FIELD
});
({
  refreshCapabilities,
  refreshAuthCatalog,
  refreshRuntime,
  refreshProviderConfig,
  refreshBrowserConfig,
  refreshTelegram
} = runtimeRefreshers);

const missionsUiController = createMissionsUiController({
  q,
  jget,
  jpost,
  setStatus,
  escapeHtml,
  localStorage,
  buildMissionCloneStatus,
  runWebuiWireValidation,
  refreshMissionTimeline,
  renderMissionTimeline,
  refreshContextStatus,
  refreshTacticalLedger,
  refreshSessionList,
  loadSession,
  showView,
  getActiveMissionId: () => activeMissionId,
  setActiveMissionId: (value) => { activeMissionId = value; },
  getLastMissionList: () => lastMissionList,
  setLastMissionList: (value) => { lastMissionList = value; },
  getMissionTimelineCache: () => missionTimelineCache,
  setSessionId: (value) => { sessionId = value; },
  getSessionId: () => sessionId
});
const {
  refreshMission,
  bindMissionActions
} = missionsUiController;
const controlPlaneController = createControlPlaneController({
  q,
  jrequest,
  refreshSessionList,
  bindControlPlaneStaticActions,
  buildResearchApproveBody,
  buildModelScoutRunBody,
  buildTaskRunBody,
  parseControlPlaneBody,
  getLocationOrigin: () => location.origin
});
const { bindControlPlaneActions } = controlPlaneController;
const operationsPanelActions = createOperationsPanelActions({
  q,
  jpost,
  setStatus,
  setSelectByValueOrFirst,
  refreshBrowserConfig,
  refreshRuntimeOverview,
  refreshTelegram,
  showView
});
const { bindOperationsPanelActions } = operationsPanelActions;
const chatComposerController = createChatComposerController({
  q,
  localStorage,
  topStatus,
  jpost,
  pushMsg,
  appendTypingBubble,
  renderTrace,
  formatProviderModel,
  chatFastAckTimeoutMs,
  isStatusCheckMessage,
  shouldEscalateToAuto,
  isPlanningReply,
  isCurrentSessionPending,
  updateComposerPendingState,
  getSessionId: () => sessionId,
  getSessionCache,
  getAutoEscalateEnabled: () => autoEscalateEnabled,
  getLastTaskPrompt: () => lastTaskPrompt,
  setLastTaskPrompt: (value) => { lastTaskPrompt = value; },
  getNextRequestToken: () => ++requestTokenSeq,
  addPendingSession: (sid) => pendingSessions.add(sid),
  removePendingSession: (sid) => pendingSessions.delete(sid),
  resolvePendingReply,
  runAutoMissionFromChat,
  refreshSessionList,
  refreshTacticalLedger
});
const { bindComposerActions } = chatComposerController;
const settingsActionsController = createSettingsActionsController({
  q,
  localStorage,
  jget,
  jpost,
  runWebuiWireValidation,
  setStatus,
  topStatus,
  formatProviderModel,
  buildProviderModelsPatch,
  computeOnlineFallbackSequence,
  canAddFallbackProvider,
  autoFillFallbackSequence,
  buildClearAllSessionsPayload,
  buildSessionExportFilename,
  buildSessionExportStatus,
  buildSessionImportRequest,
  buildSessionImportStatus,
  getModelProviderIds: () => MODEL_PROVIDER_IDS,
  getModelCatalog: () => modelCatalog,
  getFallbackSequence: () => fallbackSequence,
  setFallbackSequence: (value) => { fallbackSequence = value; },
  preferredModelForProvider,
  ensureFallbackSequence,
  normalizeHiddenRows,
  refreshAddRowSelectors,
  renderProviderMatrix,
  renderAuthMethodTable,
  refreshRuntime,
  refreshModel,
  refreshModelCatalog,
  refreshProviderConfig,
  refreshRuntimeOverview,
  refreshContextStatus,
  refreshTacticalLedger,
  refreshPhase0Diagnostics,
  refreshSessionList,
  loadSession,
  resetSession,
  loadModelsForProvider,
  renderFallbackSequence,
  showView,
  getSessionId: () => sessionId,
  setSessionId: (value) => { sessionId = value; },
  getHiddenProviderRows: () => hiddenProviderRows,
  setHiddenProviderRows: (value) => { hiddenProviderRows = value; },
  getHiddenServiceRows: () => hiddenServiceRows,
  setHiddenServiceRows: (value) => { hiddenServiceRows = value; },
  getAuthCatalog: () => authCatalog
});
const { bindSettingsActions } = settingsActionsController;
const settingsToolingController = createSettingsToolingController({
  q,
  jget,
  jpost,
  setStatus,
  runWebuiWireValidation,
  refreshRuntime
});
const { bindToolingActions, refreshToolingInventory } = settingsToolingController;
const uiShellActions = createUiShellActions({
  q,
  qa,
  localStorage,
  setStatus,
  showView,
  closeVaultModal,
  saveVaultModal,
  testVaultModal,
  getAutoEscalateEnabled: () => autoEscalateEnabled,
  setAutoEscalateEnabled: (value) => { autoEscalateEnabled = value; },
  getLiveActivityEnabled: () => liveActivityEnabled,
  setLiveActivityEnabled: (value) => { liveActivityEnabled = value; }
});
const { bindUiShellActions } = uiShellActions;

bindMissionActions();
bindOperationsPanelActions();
bindControlPlaneActions();
bindComposerActions();
bindSettingsActions();
bindToolingActions();
bindUiShellActions();

setInterval(() => {
  refreshMission().catch(() => {});
}, 3000);

(async () => {
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
      //{ name: 'browser', fn: refreshBrowserConfig }, // Temporarily disabled due to CDP endpoint issues
      { name: 'overview', fn: refreshRuntimeOverview },
      { name: 'phase0-diag', fn: refreshPhase0Diagnostics },
      { name: 'telegram', fn: refreshTelegram },
      { name: 'sessions', fn: refreshSessionList },
      { name: 'load', fn: loadSession },
      { name: 'mission', fn: refreshMission },
      { name: 'context', fn: refreshContextStatus },
      //{ name: 'ledger', fn: refreshTacticalLedger }, // Temporarily disabled to speed up initialization
      { name: 'timeline', fn: refreshMissionTimeline }
    ];

    for (const step of initSteps) {
      try {
        console.log(`Starting init step: ${step.name}`);
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout after 5 seconds`)), 5000);
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
})();
