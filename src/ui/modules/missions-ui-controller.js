export function createMissionsUiController({
  q,
  jget,
  jpost,
  setStatus,
  escapeHtml,
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
}) {
  async function refreshMission() {
    let allMissions = { missions: [], schedules: [] };
    try {
      allMissions = await jget('/api/missions');
    } catch (err) {
      console.error('refresh_missions_list_failed', err);
    }
    const normalizedMissions = Array.isArray(allMissions.missions) ? allMissions.missions : [];
    setLastMissionList(normalizedMissions);
    const picker = q('missionPicker');
    let activeMissionId = getActiveMissionId();
    if (picker) {
      const selected = activeMissionId || picker.value || '';
      picker.innerHTML = '<option value="">Select mission...</option>' + normalizedMissions
        .map((m) => {
          const id = String(m.id || '').trim();
          const label = `${id} | ${String(m.status || 'unknown')} | ${String(m.goal || '').slice(0, 80)}`;
          return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
        })
        .join('');
      if (selected && normalizedMissions.some((m) => String(m.id || '') === selected)) {
        picker.value = selected;
      }
    }
    if (!activeMissionId && normalizedMissions.length > 0) {
      activeMissionId = String(normalizedMissions[0].id || '');
      setActiveMissionId(activeMissionId);
      localStorage.setItem('openunum_mission', activeMissionId);
    }

    if (activeMissionId) {
      try {
        const out = await jget(`/api/missions/status?id=${encodeURIComponent(activeMissionId)}`);
        if (out.error) {
          q('missionStatus').textContent = out.error;
        } else {
          const m = out.mission;
          const stepLimit = m.effectiveStepLimit || m.hardStepCap || m.maxSteps;
          const limitLabel = m.limitSource === 'hardStepCap' ? 'hard-cap' : 'max-steps';
          q('missionStatus').textContent = `${m.status} step=${m.step}/${stepLimit} (${limitLabel})`;
          const latest = m.log?.[m.log.length - 1];
          if (latest) q('pcOutput').value = latest.reply;
          if (m.status !== 'running' && m.status !== 'stopping') {
            q('missionStatus').textContent = `${m.status} step=${m.step}/${stepLimit} (${limitLabel}) (select another mission or start new)`;
          }
        }
      } catch {
        q('missionStatus').textContent = `mission_not_found: ${activeMissionId}`;
      }
    } else {
      q('missionStatus').textContent = 'idle';
    }
    await refreshMissionTimeline().catch(() => {});

    try {
      const schedules = allMissions.schedules || [];
      const host = q('scheduledMissionsList');
      if (host) {
        if (schedules.length === 0) {
          host.innerHTML = 'No scheduled missions.';
        } else {
          host.innerHTML = schedules.map(s => {
            const nextRun = s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : 'not scheduled';
            return '<div class="ledger-item">' +
              '<strong>' + escapeHtml(s.goal || 'No goal') + '</strong><br/>' +
              '<div class="hint">ID: ' + escapeHtml(s.id) + ' | Status: ' + escapeHtml(s.status) + ' | Next: ' + nextRun + '</div>' +
              '</div>';
          }).join('');
        }
      }
    } catch (err) {
      console.error('refresh_scheduled_missions_failed', err);
    }
  }

  function bindMissionActions() {
    q('startMission').onclick = async () => {
      const goal = q('missionGoal').value.trim();
      if (!goal) return;
      const out = await jpost('/api/missions/start', {
        goal,
        maxSteps: Number(q('missionSteps').value || 6),
        intervalMs: Number(q('missionInterval').value || 400)
      });
      setActiveMissionId(out.id);
      localStorage.setItem('openunum_mission', out.id);
      setStatus('missionStatus', `running id=${out.id}`, { type: 'success', title: 'Mission' });
      await refreshMission();
      await refreshMissionTimeline();
      await runWebuiWireValidation('mission_start');
    };

    q('stopMission').onclick = async () => {
      const activeMissionId = getActiveMissionId();
      if (!activeMissionId) return;
      await jpost('/api/missions/stop', { id: activeMissionId });
      setStatus('missionStatus', `stopping mission ${activeMissionId}`, { type: 'warn', title: 'Mission' });
      await refreshMission();
      await refreshMissionTimeline();
      await runWebuiWireValidation('mission_stop');
    };

    q('refreshMission').onclick = refreshMission;
    q('loadMissionBtn').onclick = async () => {
      const picked = String(q('missionPicker')?.value || '').trim();
      if (!picked) return;
      setActiveMissionId(picked);
      localStorage.setItem('openunum_mission', picked);
      await refreshMission();
      await refreshMissionTimeline();
    };
    q('clearMissionSelectionBtn').onclick = async () => {
      setActiveMissionId('');
      localStorage.removeItem('openunum_mission');
      if (q('missionPicker')) q('missionPicker').value = '';
      await refreshMission();
      await refreshMissionTimeline();
    };
    q('missionPicker').onchange = async () => {
      const picked = String(q('missionPicker')?.value || '').trim();
      if (!picked) return;
      setActiveMissionId(picked);
      localStorage.setItem('openunum_mission', picked);
      await refreshMission();
      await refreshMissionTimeline();
    };
    q('openMissionSessionBtn').onclick = async () => {
      if (!getMissionTimelineCache()?.mission?.sessionId) return;
      const newSessionId = getMissionTimelineCache().mission.sessionId;
      setSessionId(newSessionId);
      localStorage.setItem('openunum_session', newSessionId);
      q('chatMeta').textContent = newSessionId;
      await loadSession();
      await refreshSessionList();
      await refreshContextStatus();
      await refreshTacticalLedger();
      showView('chat');
    };
    q('cloneMissionSessionBtn').onclick = async () => {
      const sourceSessionId = getMissionTimelineCache()?.mission?.sessionId;
      if (!sourceSessionId) return;
      const targetSessionId = crypto.randomUUID();
      const out = await jpost('/api/sessions/clone', { sourceSessionId, targetSessionId });
      setSessionId(out.session.sessionId);
      localStorage.setItem('openunum_session', out.session.sessionId);
      q('chatMeta').textContent = out.session.sessionId;
      await loadSession();
      await refreshSessionList();
      await refreshContextStatus();
      await refreshTacticalLedger();
      setStatus('runtimeStatus', buildMissionCloneStatus(sourceSessionId, out.session.sessionId), {
        type: 'success',
        title: 'Mission'
      });
      showView('chat');
    };
    q('missionTimelineFilter').onchange = () => renderMissionTimeline();
    q('missionTimelineSearch').oninput = () => renderMissionTimeline();
  }

  return {
    refreshMission,
    bindMissionActions
  };
}
