import { q, qa, escapeHtml, sleep } from './modules/dom.js';
import { jget, jpost, jrequest } from './modules/http.js';
import { setStatus } from './modules/feedback.js';
import { showView as showViewWithMeta, initSettingsHub, initSidebar } from './modules/navigation.js';
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
  createProviderVaultHelpers
} from './modules/provider-vault-helpers.js';
import { createWebuiWireValidator } from './modules/wire-validation.js';
import { createProviderVaultActions } from './modules/provider-vault-actions.js';
import { createProviderVaultRenderers } from './modules/provider-vault-renderers.js';
import { createRuntimePanelsController } from './modules/runtime-panels.js';
import { createModelCatalogController } from './modules/model-catalog-controller.js';
import { createSessionController } from './modules/session-controller.js';
import { createChatPendingController } from './modules/chat-pending-controller.js';
import { createAssetGalleryController } from './modules/asset-gallery.js';
import { createAutoMissionRunner } from './modules/chat-auto-mission.js';
import { runUiBootstrap, runDeferredStepsForCategory } from './modules/ui-bootstrap.js';
import { initializeUiState } from './modules/ui-state-init.js';
import { createUiStateHelpers } from './modules/ui-state-helpers.js';
import { wireUiLifecycle } from './modules/ui-lifecycle.js';
import { composeAppControllers } from './modules/app-composition.js';
import { setSelectByValueOrFirst as setSelectByValueOrFirstWithQ } from './modules/routing-ui-helpers.js';
import {
  VIEW_META,
  DEFAULT_MODEL_PROVIDER_IDS,
  DEFAULT_SERVICE_PROVIDER_IDS,
  SERVICE_SECRET_FIELD,
  PROVIDER_SECRET_FIELD,
  PROVIDER_BASE_FIELD
} from './modules/ui-constants.js';
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

const topStatus = q('topStatus');
const chat = q('chat');
const sessionListEl = q('sessionList');
const uiState = initializeUiState({
  localStorage,
  q,
  loadDetailPanelState,
  defaultModelProviderIds: DEFAULT_MODEL_PROVIDER_IDS,
  defaultServiceProviderIds: DEFAULT_SERVICE_PROVIDER_IDS,
  createId: () => crypto.randomUUID()
});
let {
  MODEL_PROVIDER_IDS,
  SERVICE_PROVIDER_IDS,
  sessionId,
  activeMissionId,
  lastTaskPrompt,
  autoEscalateEnabled,
  liveActivityEnabled,
  modelCatalog,
  authCatalog,
  runtimeOverview,
  missionTimelineCache,
  sessionLoadToken,
  requestTokenSeq,
  fallbackSequence,
  providerAdvancedOpen,
  serviceAdvancedOpen,
  runtimeConfigCache,
  lastMissionList,
  hiddenProviderRows,
  hiddenServiceRows,
  authJobPrompted,
  detailPanelState,
  refreshCapabilities,
  refreshAuthCatalog,
  refreshRuntime,
  refreshProviderConfig,
  refreshBrowserConfig,
  refreshTelegram,
  renderProviderSelectors,
  renderFallbackSequence,
  closeVaultModal
} = uiState;
const { pendingSessions, vaultModalState } = uiState;
const uiStateHelpers = createUiStateHelpers({
  q,
  localStorage,
  pendingSessions,
  getSessionId: () => sessionId,
  getDetailPanelState: () => detailPanelState,
  rememberDetailPanelStateWithStorage,
  showViewWithMeta,
  viewMeta: VIEW_META
});
const {
  isCurrentSessionPending,
  updateComposerPendingState,
  rememberDetailPanelState,
  showView
} = uiStateHelpers;

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
  renderTrace,
  appendTokenToBubble,
  appendReasoningToken,
  addToolCallToBubble,
  finalizeStreamingBubble
} = chatRenderer;
const assetGallery = createAssetGalleryController({ jget, escapeHtml });
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
function setSelectByValueOrFirst(id, value) {
  setSelectByValueOrFirstWithQ(q, id, value);
}
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
  jpost,
  escapeHtml,
  setStatus,
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
  refreshAutonomyDashboardLocal: refreshAutonomyDashboard,
  refreshTacticalLedger,
  refreshMissionTimeline,
  renderMissionTimeline,
  bindAutonomyDashboardActions
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
  resumePendingSessionIfNeeded: (sid) => resumePendingSessionIfNeeded(sid),
  renderImageAttachments: chatRenderer.renderImageAttachments,
  refreshGallery: assetGallery.refreshGallery
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
  detailPanelKey,
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
  removePendingSession: (sid) => pendingSessions.delete(sid),
  renderImageAttachments: chatRenderer.renderImageAttachments
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
const composed = composeAppControllers({
  q,
  qa,
  jget,
  jpost,
  jrequest,
  setStatus,
  localStorage,
  normalizeServiceCapabilityIds,
  stripProviderPrefix,
  formatProviderModel,
  shouldEscalateToAuto,
  isStatusCheckMessage,
  isPlanningReply,
  chatFastAckTimeoutMs,
  refreshRuntimeOverview,
  refreshPhase0Diagnostics,
  refreshContextStatus,
  refreshTacticalLedger,
  refreshMissionTimeline,
  renderMissionTimeline,
  refreshModel,
  refreshModelCatalog,
  loadModelsForProvider,
  runWebuiWireValidation,
  normalizeHiddenRows,
  refreshAddRowSelectors,
  renderProviderMatrix,
  renderAuthMethodTable,
  preferredModelForProvider,
  ensureFallbackSequence,
  buildFallbackModelOptions,
  getModelProviderIds: () => MODEL_PROVIDER_IDS,
  setModelProviderIds: (value) => { MODEL_PROVIDER_IDS = value; },
  setServiceProviderIds: (value) => { SERVICE_PROVIDER_IDS = value; },
  getServiceSecretField: () => SERVICE_SECRET_FIELD,
  getRuntimeConfigCache: () => runtimeConfigCache,
  setRuntimeConfigCache: (value) => { runtimeConfigCache = value; },
  setAuthCatalog: (value) => { authCatalog = value; },
  getFallbackSequence: () => fallbackSequence,
  setFallbackSequence: (value) => { fallbackSequence = value; },
  getModelCatalog: () => modelCatalog,
  getAuthCatalog: () => authCatalog,
  getHiddenProviderRows: () => hiddenProviderRows,
  setHiddenProviderRows: (value) => { hiddenProviderRows = value; },
  getHiddenServiceRows: () => hiddenServiceRows,
  setHiddenServiceRows: (value) => { hiddenServiceRows = value; },
  getProviderAdvancedOpen: () => providerAdvancedOpen,
  getServiceAdvancedOpen: () => serviceAdvancedOpen,
  closeVaultModalState: (fn) => { closeVaultModal = fn; },
  vaultModalState,
  authJobPrompted,
  refreshSessionList,
  loadSession,
  resetSession,
  getSessionId: () => sessionId,
  setSessionId: (value) => { sessionId = value; },
  getActiveMissionId: () => activeMissionId,
  setActiveMissionId: (value) => { activeMissionId = value; },
  getLastMissionList: () => lastMissionList,
  setLastMissionList: (value) => { lastMissionList = value; },
  getMissionTimelineCache: () => missionTimelineCache,
  getSessionCache,
  getAutoEscalateEnabled: () => autoEscalateEnabled,
  setAutoEscalateEnabled: (value) => { autoEscalateEnabled = value; },
  getLiveActivityEnabled: () => liveActivityEnabled,
  setLiveActivityEnabled: (value) => { liveActivityEnabled = value; },
  getLastTaskPrompt: () => lastTaskPrompt,
  setLastTaskPrompt: (value) => { lastTaskPrompt = value; },
  getNextRequestToken: () => ++requestTokenSeq,
  addPendingSession: (sid) => pendingSessions.add(sid),
  removePendingSession: (sid) => pendingSessions.delete(sid),
  resolvePendingReply,
  runAutoMissionFromChat,
  topStatus,
  pushMsg,
  appendTypingBubble,
  renderTrace,
  showView,
  refreshAutonomyDashboard,
  bindControlPlaneStaticActions,
  buildResearchApproveBody,
  buildModelScoutRunBody,
  buildTaskRunBody,
  parseControlPlaneBody,
  getLocationOrigin: () => location.origin,
  escapeHtml,
  isCurrentSessionPending,
  updateComposerPendingState,
  saveVaultModal,
  testVaultModal,
  renderImageAttachments: chatRenderer.renderImageAttachments
});
({
  refreshCapabilities,
  refreshAuthCatalog,
  refreshRuntime,
  refreshProviderConfig,
  refreshBrowserConfig,
  refreshTelegram
} = composed);
const {
  refreshMission,
  refreshToolingInventory,
  bindMissionActions,
  bindControlPlaneActions,
  bindOperationsPanelActions,
  bindComposerActions,
  bindSettingsActions,
  bindToolingActions,
  bindUiShellActions
} = composed;

wireUiLifecycle({
  bindMissionActions,
  bindOperationsPanelActions,
  bindControlPlaneActions,
  bindComposerActions,
  bindSettingsActions,
  bindToolingActions,
  bindUiShellActions,
  bindAutonomyDashboardActions,
  refreshMission,
  runUiBootstrap,
  bootstrapContext: {
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
  }
});

initSettingsHub();
initSidebar();

// Expose deferred loading for settings hub category clicks
window.__openunum_runDeferredStepsForCategory = runDeferredStepsForCategory;
