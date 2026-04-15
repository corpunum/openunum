export function createAutonomyDashboardPanel({
  q,
  jget,
  jpost,
  escapeHtml,
  setStatus
}) {
  function setText(id, value) {
    const el = q(id);
    if (!el) return;
    el.textContent = String(value ?? '');
  }

  function buildRemediationRows(items = []) {
    if (!items.length) return '<div class="ledger-item">No remediation items.</div>';
    return items.slice(0, 8).map((item) => {
      const title = escapeHtml(item.title || item.id || 'remediation');
      const status = escapeHtml(item.status || 'unknown');
      const severity = escapeHtml(item.severity || '-');
      const observed = Number(item.observedCount || 0);
      const updatedAt = escapeHtml(item.updatedAt || item.createdAt || '-');
      const id = escapeHtml(item.id || '');
      return `<div class="ledger-item"><strong>${title}</strong> | status=${status} | severity=${severity} | observed=${observed} | id=${id} | updated=${updatedAt}</div>`;
    }).join('');
  }

  function buildQueueRows(rows = []) {
    if (!rows.length) return '<div class="ledger-item">No stuck sessions.</div>';
    return rows.slice(0, 8).map((item) => {
      const sid = escapeHtml(item.sessionId || '-');
      const turn = escapeHtml(item.turnId || '-');
      const age = Number(item.ageMs || 0);
      const startedAt = escapeHtml(item.startedAt || '-');
      return `<div class="ledger-item">session=${sid} | turn=${turn} | ageMs=${age} | started=${startedAt}</div>`;
    }).join('');
  }

  async function refreshAutonomyDashboard() {
    const [masterStatus, remediations, chatDiag] = await Promise.all([
      jget('/api/autonomy/master/status'),
      jget('/api/autonomy/remediations?limit=40'),
      jget('/api/chat/diagnostics?limit=60')
    ]);
    const status = masterStatus?.status || {};
    const awareness = status?.selfAwareness || {};
    const pendingQueue = status?.pendingQueue || {};
    const remediationRows = Array.isArray(remediations?.items)
      ? remediations.items
      : (status?.remediation?.items || []);
    const stuckRows = Array.isArray(pendingQueue?.stuckSessions) ? pendingQueue.stuckSessions : [];

    setText('autonomySelfAwarenessValue', `${Number(awareness.score || 0)} (${awareness.status || 'unknown'})`);
    setText(
      'autonomySelfAwarenessMeta',
      `issues=${Array.isArray(awareness.issues) ? awareness.issues.length : 0} | sampled=${awareness.sampledAt || '-'}`
    );
    setText(
      'autonomyQueueValue',
      `${Number(pendingQueue.stuckCount || 0)} stuck / ${Number(pendingQueue.pendingCount || 0)} pending`
    );
    setText(
      'autonomyQueueMeta',
      `oldestMs=${Number(pendingQueue.oldestAgeMs || 0)} | thresholdMs=${Number(pendingQueue.thresholdMs || 0)}`
    );
    setText(
      'autonomyRemediationValue',
      `${Number(remediationRows.length || 0)} items`
    );
    setText(
      'autonomyRemediationMeta',
      `queueDiagPending=${Number(chatDiag?.pendingCount || 0)} | queueDiagStuck=${Number(chatDiag?.stuckCount || 0)}`
    );
    const summary = [
      `selfAwareness=${Number(awareness.score || 0)} (${awareness.status || 'unknown'})`,
      `pendingQueue: stuck=${Number(pendingQueue.stuckCount || 0)} pending=${Number(pendingQueue.pendingCount || 0)}`,
      `remediations=${Number(remediationRows.length || 0)}`
    ].join(' | ');
    const summaryEl = q('autonomyDashboardSummary');
    if (summaryEl) summaryEl.textContent = summary;
    const remEl = q('autonomyRemediationList');
    if (remEl) remEl.innerHTML = buildRemediationRows(remediationRows);
    const queueEl = q('autonomyQueueList');
    if (queueEl) queueEl.innerHTML = buildQueueRows(stuckRows);
  }

  async function runRemediationAction(action) {
    const id = String(q('autonomyRemediationId')?.value || '').trim();
    const note = String(q('autonomyRemediationNote')?.value || '').trim();
    if (!id) {
      setStatus('runtimeStatus', 'remediation id is required', { type: 'warn', title: 'Autonomy' });
      return;
    }
    const body = { id };
    if (action === 'resolve') body.resolution = note;
    if (action === 'fail') body.error = note;
    if (action === 'cancel') body.reason = note;
    const out = await jpost(`/api/autonomy/remediations/${action}`, body);
    setStatus(
      'runtimeStatus',
      out?.ok
        ? `remediation ${action}: ${id}`
        : `remediation ${action} failed: ${String(out?.error || 'unknown')}`,
      { type: out?.ok ? 'success' : 'error', title: 'Autonomy' }
    );
    await refreshAutonomyDashboard();
  }

  function bindAutonomyDashboardActions() {
    const refreshBtn = q('refreshAutonomyDashboardBtn');
    if (refreshBtn) refreshBtn.onclick = () => refreshAutonomyDashboard().catch(() => {});
    const syncBtn = q('syncAutonomyRemediationBtn');
    if (syncBtn) syncBtn.onclick = async () => {
      const out = await jpost('/api/autonomy/remediations/sync-self-awareness', {});
      setStatus(
        'runtimeStatus',
        out?.ok ? 'synced remediation from self-awareness' : `sync failed: ${String(out?.error || 'unknown')}`,
        { type: out?.ok ? 'success' : 'error', title: 'Autonomy' }
      );
      await refreshAutonomyDashboard();
    };
    const startBtn = q('startAutonomyRemediationBtn');
    if (startBtn) startBtn.onclick = () => runRemediationAction('start').catch(() => {});
    const resolveBtn = q('resolveAutonomyRemediationBtn');
    if (resolveBtn) resolveBtn.onclick = () => runRemediationAction('resolve').catch(() => {});
    const failBtn = q('failAutonomyRemediationBtn');
    if (failBtn) failBtn.onclick = () => runRemediationAction('fail').catch(() => {});
    const cancelBtn = q('cancelAutonomyRemediationBtn');
    if (cancelBtn) cancelBtn.onclick = () => runRemediationAction('cancel').catch(() => {});
  }

  return {
    refreshAutonomyDashboard,
    bindAutonomyDashboardActions
  };
}

