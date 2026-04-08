import { describe, it, expect } from 'vitest';
import { buildRuntimeOverviewView } from '../../src/ui/modules/runtime-overview.js';

describe('ui runtime overview helpers', () => {
  it('builds runtime and browser status view fields', () => {
    const view = buildRuntimeOverviewView({
      autonomyMode: 'autonomy-first',
      workspaceRoot: '/tmp/ws',
      git: { ok: true, branch: 'main', ahead: 1, behind: 0, modified: 2 },
      providers: [
        { provider: 'ollama-cloud', status: 'healthy' },
        { provider: 'openrouter', status: 'degraded' }
      ],
      executionEnvelope: { tier: 'full', toolAllowlist: null, maxToolIterations: 8 },
      autonomyPolicy: { mode: 'execute', enforceSelfProtection: true },
      providerAvailability: [{ provider: 'openrouter', blocked: true, lastFailureKind: 'timeout' }],
      browser: { ok: false, error: 'cdp_down', targets: [{}, {}] }
    }, 'http://127.0.0.1:9222');

    expect(view.runtimeProviderValue).toBe('1 degraded');
    expect(view.runtimeProviderMeta.includes('openrouter:degraded')).toBe(true);
    expect(view.runtimeProviderMeta.includes('cooldown=openrouter:timeout')).toBe(true);
    expect(view.browserHealthValue).toBe('Degraded');
    expect(view.browserTabMeta).toBe('2 visible targets');
  });
});
