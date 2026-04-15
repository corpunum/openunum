export function createMissionTimelinePanel({
  q,
  jget,
  showView,
  escapeHtml,
  buildMissionTimelineView,
  getActiveMissionId,
  getMissionTimelineCache,
  setMissionTimelineCache
}) {
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
    refreshMissionTimeline,
    renderMissionTimeline
  };
}

