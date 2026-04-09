export function createRuntimePanelsController({
  q,
  jget,
  escapeHtml,
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

  async function refreshMissionTimeline() {
    const activeMissionId = getActiveMissionId();
    if (!activeMissionId) {
      q('missionTimelineSummary').textContent = 'No active mission.';
      q('missionTimelineLog').innerHTML = '';
      q('missionTimelineTools').innerHTML = '';
      q('missionTimelineArtifacts').innerHTML = '';
      setMissionTimelineCache(null);
      return;
    }
    setMissionTimelineCache(await jget(`/api/missions/timeline?id=${encodeURIComponent(activeMissionId)}`));
    renderMissionTimeline();
  }

  function renderMissionTimeline() {
    const out = getMissionTimelineCache();
    if (!out) return;
    const filter = q('missionTimelineFilter')?.value || 'all';
    const search = String(q('missionTimelineSearch')?.value || '').trim().toLowerCase();
    const view = buildMissionTimelineView(out, { filter, search, escapeHtml });
    q('missionTimelineSummary').textContent = view.summaryText;
    q('missionTimelineLog').innerHTML = view.logHtml;
    q('missionTimelineTools').innerHTML = view.toolsHtml;
    q('missionTimelineArtifacts').innerHTML = view.artifactsHtml;
    q('missionTimelineArtifacts').querySelectorAll('[data-artifact-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = out.artifacts?.[Number(btn.dataset.artifactIndex)];
        if (!item) return;
        q('pcOutput').value = JSON.stringify(item, null, 2);
        showView('operator');
      });
    });
  }

  return {
    refreshRuntimeOverview,
    refreshPhase0DiagnosticsLocal,
    refreshContextStatusLocal,
    refreshTacticalLedger,
    refreshMissionTimeline,
    renderMissionTimeline
  };
}
