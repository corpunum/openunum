import {
  providerChoicesForFallbackRow,
  canAddFallbackProvider,
  autoFillFallbackSequence,
  computeOnlineFallbackSequence,
  buildProviderModelsPatch
} from './model-routing.js';
import {
  buildClearAllSessionsPayload,
  buildSessionExportFilename,
  buildSessionExportStatus,
  buildSessionImportRequest,
  buildSessionImportStatus,
  buildMissionCloneStatus
} from './session-io.js';
import {
  setSelectByValueOrFirst as setSelectByValueOrFirstWithQ,
  createRoutingUiHelpers
} from './routing-ui-helpers.js';
import { closeVaultModal as closeVaultModalWithState } from './vault-modal.js';
import { createRuntimeRefreshers } from './runtime-refreshers.js';
import { createMissionsUiController } from './missions-ui-controller.js';
import { createControlPlaneController } from './control-plane-controller.js';
import { createOperationsPanelActions } from './operations-panel-actions.js';
import { createChatComposerController } from './chat-composer-controller.js';
import { createSettingsActionsController } from './settings-actions-controller.js';
import { createSettingsToolingController } from './settings-tooling-controller.js';
import { createUiShellActions } from './ui-shell-actions.js';

export function composeAppControllers(ctx) {
  const {
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
    setSelectByValueOrFirstFn,
    getModelProviderIds,
    setModelProviderIds,
    setServiceProviderIds,
    getServiceSecretField,
    getRuntimeConfigCache,
    setRuntimeConfigCache,
    setAuthCatalog,
    getFallbackSequence,
    setFallbackSequence,
    getModelCatalog,
    getAuthCatalog,
    getHiddenProviderRows,
    setHiddenProviderRows,
    getHiddenServiceRows,
    setHiddenServiceRows,
    getProviderAdvancedOpen,
    getServiceAdvancedOpen,
    closeVaultModalState,
    vaultModalState,
    authJobPrompted,
    refreshSessionList,
    loadSession,
    resetSession,
    getSessionId,
    setSessionId,
    getActiveMissionId,
    setActiveMissionId,
    getLastMissionList,
    setLastMissionList,
    getMissionTimelineCache,
    getSessionCache,
    getAutoEscalateEnabled,
    setAutoEscalateEnabled,
    getLiveActivityEnabled,
    setLiveActivityEnabled,
    getLastTaskPrompt,
    setLastTaskPrompt,
    getNextRequestToken,
    addPendingSession,
    removePendingSession,
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
    getLocationOrigin
  } = ctx;

  function setSelectByValueOrFirst(id, value) {
    setSelectByValueOrFirstWithQ(q, id, value);
  }

  const routingUiHelpers = createRoutingUiHelpers({
    q,
    qa,
    getModelProviderIds,
    getFallbackSequence,
    setFallbackSequence,
    ensureFallbackSequence,
    preferredModelForProvider,
    providerChoicesForFallbackRow,
    buildFallbackModelOptions,
    setSelectByValueOrFirstFn: (id, value) => setSelectByValueOrFirst(id, value)
  });
  let { renderProviderSelectors, renderFallbackSequence } = routingUiHelpers;

  let closeVaultModal = (modalId = 'vaultEditModal') => closeVaultModalWithState(q, vaultModalState, modalId);

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
    getModelProviderIds,
    setModelProviderIds,
    setServiceProviderIds,
    getRuntimeConfigCache,
    setRuntimeConfigCache,
    setAuthCatalog,
    getFallbackSequence,
    setFallbackSequence,
    getServiceSecretField
  });
  const {
    refreshCapabilities,
    refreshAuthCatalog,
    refreshRuntime,
    refreshProviderConfig,
    refreshBrowserConfig,
    refreshTelegram
  } = runtimeRefreshers;

  const missionsUiController = createMissionsUiController({
    q,
    jget,
    jpost,
    setStatus,
    escapeHtml: ctx.escapeHtml,
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
    getActiveMissionId,
    setActiveMissionId,
    getLastMissionList,
    setLastMissionList,
    getMissionTimelineCache,
    setSessionId,
    getSessionId
  });
  const { refreshMission, bindMissionActions } = missionsUiController;

  const controlPlaneController = createControlPlaneController({
    q,
    jrequest,
    refreshSessionList,
    bindControlPlaneStaticActions,
    buildResearchApproveBody,
    buildModelScoutRunBody,
    buildTaskRunBody,
    parseControlPlaneBody,
    getLocationOrigin
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
    isCurrentSessionPending: ctx.isCurrentSessionPending,
    updateComposerPendingState: ctx.updateComposerPendingState,
    getSessionId,
    getSessionCache,
    getAutoEscalateEnabled,
    getLastTaskPrompt,
    setLastTaskPrompt,
    getNextRequestToken,
    addPendingSession,
    removePendingSession,
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
    getModelProviderIds,
    getModelCatalog,
    getFallbackSequence,
    setFallbackSequence,
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
    refreshAutonomyDashboard,
    refreshContextStatus,
    refreshTacticalLedger,
    refreshPhase0Diagnostics,
    refreshSessionList,
    loadSession,
    resetSession,
    loadModelsForProvider,
    renderFallbackSequence,
    showView,
    getSessionId,
    setSessionId,
    getHiddenProviderRows,
    setHiddenProviderRows,
    getHiddenServiceRows,
    setHiddenServiceRows,
    getAuthCatalog
  });
  const { bindSettingsActions } = settingsActionsController;

  const settingsToolingController = createSettingsToolingController({
    q,
    qa,
    jget,
    jpost,
    setStatus,
    runWebuiWireValidation,
    refreshRuntime,
    closeVaultModal
  });
  const { bindToolingActions, refreshToolingInventory } = settingsToolingController;

  const uiShellActions = createUiShellActions({
    q,
    qa,
    localStorage,
    setStatus,
    showView,
    closeVaultModal,
    saveVaultModal: ctx.saveVaultModal,
    testVaultModal: ctx.testVaultModal,
    getAutoEscalateEnabled,
    setAutoEscalateEnabled,
    getLiveActivityEnabled,
    setLiveActivityEnabled
  });
  const { bindUiShellActions } = uiShellActions;

  closeVaultModalState((modalId = 'vaultEditModal') => closeVaultModalWithState(q, vaultModalState, modalId));

  return {
    refreshCapabilities,
    refreshAuthCatalog,
    refreshRuntime,
    refreshProviderConfig,
    refreshBrowserConfig,
    refreshTelegram,
    refreshMission,
    refreshToolingInventory,
    bindMissionActions,
    bindControlPlaneActions,
    bindOperationsPanelActions,
    bindComposerActions,
    bindSettingsActions,
    bindToolingActions,
    bindUiShellActions,
    setSelectByValueOrFirst,
    renderProviderSelectors,
    renderFallbackSequence,
    closeVaultModal
  };
}

