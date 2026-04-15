import { describe, expect, test, vi } from 'vitest';
import { wireUiLifecycle } from '../../src/ui/modules/ui-lifecycle.js';

describe('wireUiLifecycle', () => {
  test('binds controllers and invokes bootstrap', () => {
    const calls = [];
    const mk = (name) => () => calls.push(name);
    const runUiBootstrap = vi.fn();

    const out = wireUiLifecycle({
      bindMissionActions: mk('mission'),
      bindOperationsPanelActions: mk('ops'),
      bindControlPlaneActions: mk('cp'),
      bindComposerActions: mk('composer'),
      bindSettingsActions: mk('settings'),
      bindToolingActions: mk('tooling'),
      bindUiShellActions: mk('shell'),
      bindAutonomyDashboardActions: mk('autonomy'),
      refreshMission: async () => {},
      runUiBootstrap,
      bootstrapContext: { ok: true },
      missionRefreshIntervalMs: 10000
    });

    expect(calls).toEqual(['mission', 'ops', 'cp', 'composer', 'settings', 'tooling', 'shell', 'autonomy']);
    expect(runUiBootstrap).toHaveBeenCalledWith({ ok: true });
    expect(out.missionTimer).toBeDefined();
    clearInterval(out.missionTimer);
  });
});

