export function buildRuntimeOverviewView(runtimeOverview = {}, cdpPresetValue = '') {
  const git = runtimeOverview.git || {};
  const providers = Array.isArray(runtimeOverview.providers) ? runtimeOverview.providers : [];
  const degradedCount = providers.filter((p) => p.status !== 'healthy').length;
  const envelope = runtimeOverview.executionEnvelope || {};
  const policy = runtimeOverview.autonomyPolicy || {};
  const unavailableProviders = (runtimeOverview.providerAvailability || []).filter((row) => row.blocked);
  const browserInfo = runtimeOverview.browser || {};
  const targets = Array.isArray(browserInfo.targets) ? browserInfo.targets : [];

  let runtimeProviderMeta = providers
    .map((p) => `${p.provider}:${p.status}`)
    .join(' | ') || 'No providers';
  if (envelope.tier) {
    runtimeProviderMeta += ` | envelope=${envelope.tier} tools=${Array.isArray(envelope.toolAllowlist) ? envelope.toolAllowlist.length : 'all'} maxIters=${envelope.maxToolIterations || '-'}`;
  }
  runtimeProviderMeta += ` | policy=${policy.mode || 'execute'} selfProtect=${policy.enforceSelfProtection !== false ? 'on' : 'off'}`;
  if (unavailableProviders.length) {
    runtimeProviderMeta += ` | cooldown=${unavailableProviders.map((row) => `${row.provider}:${row.lastFailureKind || 'unknown'}`).join(',')}`;
  }

  return {
    runtimeAutonomyValue: runtimeOverview.autonomyMode || 'autonomy-first',
    runtimeWorkspaceMeta: runtimeOverview.workspaceRoot || '-',
    gitBranchValue: git.branch || 'no-git',
    gitBranchMeta: git.ok
      ? `ahead=${git.ahead || 0} behind=${git.behind || 0} modified=${git.modified || 0}`
      : (git.error || 'git unavailable'),
    runtimeProviderValue: degradedCount ? `${degradedCount} degraded` : 'healthy',
    runtimeProviderMeta,
    browserHealthValue: browserInfo.ok ? 'Connected' : 'Degraded',
    browserHealthMeta: browserInfo.error || browserInfo.hint || 'CDP reachable',
    browserCdpValue: browserInfo.cdpUrl || cdpPresetValue || '-',
    browserTabMeta: targets.length ? `${targets.length} visible targets` : 'No live target list'
  };
}
