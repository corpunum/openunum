import { bindSettingsModelRoutingActions } from './settings-actions-model-routing.js';
import { bindSettingsProviderVaultActions } from './settings-actions-provider-vault.js';
import { bindSettingsRuntimeSessionActions } from './settings-actions-runtime-session.js';

export function createSettingsActionsController(ctx) {
  function bindSettingsActions() {
    bindSettingsModelRoutingActions(ctx);
    bindSettingsProviderVaultActions(ctx);
    bindSettingsRuntimeSessionActions(ctx);
  }

  return {
    bindSettingsActions
  };
}

