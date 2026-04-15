import { createAutonomyDashboardPanel } from './autonomy-dashboard-panel.js';
import { createMissionTimelinePanel } from './mission-timeline-panel.js';

export function createRuntimePanelsController({
  q,
  jget,
  jpost,
  escapeHtml,
  setStatus,
  showView,
  buildRuntimeOverviewView,
  buildMissionTimelineView,
  formatPct,
  getSessionId,
  getActiveMissionId,
  getMissionTimelineCache,
  setMissionTimelineCache,
  setRuntimeOverview
}) {
  const autonomyDashboardPanel = createAutonomyDashboardPanel({
    q,
    jget,
    jpost,
    escapeHtml,
    setStatus
  });
  const missionTimelinePanel = createMissionTimelinePanel({
    q,
    jget,
    showView,
    escapeHtml,
    buildMissionTimelineView,
    getActiveMissionId,
    getMissionTimelineCache,
    setMissionTimelineCache
  });

  async function refreshRuntimeOverview() {
    const runtimeOverview = await jget('/api/runtime/overview');
    setRuntimeOverview(runtimeOverview);
    const view = buildRuntimeOverviewView(runtimeOverview, q('cdpPreset')?.value || '');
    q('runtimeAutonomyValue').textContent = view.runtimeAutonomyValue;
    q('runtimeWorkspaceMeta').textContent = view.runtimeWorkspaceMeta;
    q('gitBranchValue').textContent = view.gitBranchValue;
    q('gitBranchMeta').textContent = view.gitBranchMeta;
    q('runtimeProviderValue').textContent = view.runtimeProviderValue;
    q('runtimeProviderMeta').textContent = view.runtimeProviderMeta;
    q('browserHealthValue').textContent = view.browserHealthValue;
    q('browserHealthMeta').textContent = view.browserHealthMeta;
    q('browserCdpValue').textContent = view.browserCdpValue;
    q('browserTabMeta').textContent = view.browserTabMeta;
    await refreshPhase0DiagnosticsLocal();
    await refreshAutonomyCycleStatusLocal();
    await autonomyDashboardPanel.refreshAutonomyDashboard();
    await refreshContextStatusLocal();
  }

  async function refreshPhase0DiagnosticsLocal() {
    const sid = String(getSessionId() || '').trim() || 'ui-runtime';
    const [stateContract, parity] = await Promise.all([
      jget(`/api/runtime/state-contract?sessionId=${encodeURIComponent(sid)}&phase=phase0&nextAction=${encodeURIComponent('Review operator diagnostics')}`),
      jget('/api/runtime/config-parity')
    ]);
    const stateOk = stateContract?.validation?.ok === true;
    q('phase0ContractValue').textContent = stateOk ? 'State OK' : 'State Warning';
    q('phase0ContractMeta').textContent =
      `contract=${stateContract?.contractVersion || '-'} | valid=${stateOk} | fp=${String(stateContract?.packet?.fingerprint || '').slice(0, 12) || '-'}`;
    q('phase0ParityMeta').textContent =
      `parity=${parity?.severity || 'unknown'} | errors=${Number(parity?.summary?.errorCount || 0)} warnings=${Number(parity?.summary?.warningCount || 0)}`;
  }

  async function refreshContextStatusLocal() {
    const sid = getSessionId();
    if (!sid) return;
    const out = await jget(`/api/context/status?sessionId=${encodeURIComponent(sid)}`);
    const budget = out.budget || {};
    q('contextBudgetValue').textContent = `${formatPct(budget.usagePct)} used`;
    q('contextBudgetMeta').textContent =
      `tokens=${Number(out.estimatedTokens || 0)} / limit=${Number(budget.contextLimit || 0)} | msgs=${Number(out.messageCount || 0)} | latest=${out.latestCompaction?.createdAt || 'none'}`;
  }

  async function refreshAutonomyCycleStatusLocal() {
    const out = await jget('/api/autonomy/cycle/status');
    if (!out?.ok) {
      q('autonomyCycleValue').textContent = 'Cycle Error';
      q('autonomyCycleMeta').textContent = String(out?.error || 'failed to read cycle snapshot');
      return;
    }
    if (!out.available) {
      q('autonomyCycleValue').textContent = 'No Snapshot';
      q('autonomyCycleMeta').textContent = out.message || 'No scheduled autonomy cycle snapshot found yet.';
      return;
    }
    const status = String(out?.lastRun?.health || 'unknown').toLowerCase();
    const ageMinutes = Number.isFinite(Number(out?.staleness?.ageMinutes))
      ? Number(out.staleness.ageMinutes)
      : null;
    q('autonomyCycleValue').textContent = status === 'healthy' ? 'Healthy' : status;
    q('autonomyCycleMeta').textContent =
      `cycle=${Number(out?.lastRun?.cycle || 0)} | age=${ageMinutes === null ? '-' : `${ageMinutes}m`} | audit=${out?.lastRun?.auditValid === true ? 'ok' : 'check'}`;
  }

  async function refreshTacticalLedger() {
    const out = await jget(`/api/autonomy/insights?sessionId=${encodeURIComponent(getSessionId())}`);
    q('ledgerSummary').textContent =
      `strategies=${Number(out.recentStrategies?.length || 0)} | tools=${Number(out.toolReliability?.length || 0)} | recentToolRuns=${Number(out.recentToolRuns?.length || 0)}`;
    q('ledgerStrategies').innerHTML = `
      <strong>Recent strategies</strong>
      ${(out.recentStrategies || []).slice(0, 5).map((item) =>
        `<div class="ledger-item">${escapeHtml(item.success ? 'SUCCESS' : 'FAIL')} | ${escapeHtml(item.strategy)} | ${escapeHtml(String(item.evidence || '').slice(0, 120))}</div>`
      ).join('') || '<div class="ledger-item">No strategy history yet.</div>'}
    `;
    q('ledgerTools').innerHTML = `
      <strong>Tool reliability</strong>
      ${(out.toolReliability || []).slice(0, 5).map((item) =>
        `<div class="ledger-item">${escapeHtml(item.toolName)} | success ${(Number(item.successRate || 0) * 100).toFixed(0)}% | total ${Number(item.total || 0)}</div>`
      ).join('') || '<div class="ledger-item">No tool reliability data yet.</div>'}
    `;
  }

  return {
    refreshRuntimeOverview,
    refreshPhase0DiagnosticsLocal,
    refreshAutonomyCycleStatusLocal,
    refreshAutonomyDashboardLocal: autonomyDashboardPanel.refreshAutonomyDashboard,
    refreshContextStatusLocal,
    refreshTacticalLedger,
    refreshMissionTimeline: missionTimelinePanel.refreshMissionTimeline,
    renderMissionTimeline: missionTimelinePanel.renderMissionTimeline,
    bindAutonomyDashboardActions: autonomyDashboardPanel.bindAutonomyDashboardActions
  };
}
