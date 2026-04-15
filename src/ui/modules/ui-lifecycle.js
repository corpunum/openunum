export function wireUiLifecycle({
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
  bootstrapContext,
  missionRefreshIntervalMs = 3000
}) {
  bindMissionActions();
  bindOperationsPanelActions();
  bindControlPlaneActions();
  bindComposerActions();
  bindSettingsActions();
  bindToolingActions();
  bindUiShellActions();
  bindAutonomyDashboardActions();

  const missionTimer = setInterval(() => {
    refreshMission().catch(() => {});
  }, missionRefreshIntervalMs);

  runUiBootstrap(bootstrapContext);

  return { missionTimer };
}

