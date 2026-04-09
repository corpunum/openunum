export function createControlPlaneController({
  q,
  jrequest,
  refreshSessionList,
  bindControlPlaneStaticActions,
  buildResearchApproveBody,
  buildModelScoutRunBody,
  buildTaskRunBody,
  parseControlPlaneBody,
  getLocationOrigin
}) {
  async function runControlPlaneRequest(method, path, body = undefined) {
    const output = q('cpOutput');
    const status = q('cpStatus');
    if (!output || !status) return;
    status.textContent = `${method} ${path} ...`;
    try {
      const out = await jrequest(method, path, body, { timeoutMs: 45000 });
      output.value = JSON.stringify(out, null, 2);
      status.textContent = `${method} ${path} ok`;
      if (path.startsWith('/api/sessions')) {
        await refreshSessionList().catch(() => {});
      }
    } catch (error) {
      output.value = JSON.stringify({ ok: false, error: String(error.message || error) }, null, 2);
      status.textContent = `${method} ${path} failed`;
    }
  }

  function bindControlPlaneActions() {
    bindControlPlaneStaticActions(q, runControlPlaneRequest);

    q('cpResearchApprove').onclick = () =>
      runControlPlaneRequest(
        'POST',
        '/api/research/approve',
        buildResearchApproveBody(q('cpResearchUrl').value, q('cpResearchNote').value)
      );

    q('cpWorkerStatus').onclick = () => {
      const id = q('cpWorkerId').value.trim();
      if (!id) return;
      runControlPlaneRequest('GET', `/api/autonomy/workers/status?id=${encodeURIComponent(id)}`);
    };

    q('cpSelfEditStatus').onclick = () => {
      const id = q('cpSelfEditId').value.trim();
      if (!id) return;
      runControlPlaneRequest('GET', `/api/autonomy/self-edit/status?id=${encodeURIComponent(id)}`);
    };

    q('cpModelScoutRun').onclick = () =>
      runControlPlaneRequest('POST', '/api/autonomy/model-scout/run', buildModelScoutRunBody(q('cpModelScoutQuery').value));

    q('cpModelScoutStatus').onclick = () => {
      const id = q('cpModelScoutId').value.trim();
      if (!id) return;
      runControlPlaneRequest('GET', `/api/autonomy/model-scout/status?id=${encodeURIComponent(id)}`);
    };

    q('cpTaskRun').onclick = () =>
      runControlPlaneRequest('POST', '/api/autonomy/tasks/run', buildTaskRunBody(q('cpTaskGoal').value, getLocationOrigin()));

    q('cpTaskStatus').onclick = () => {
      const id = q('cpTaskId').value.trim();
      if (!id) return;
      runControlPlaneRequest('GET', `/api/autonomy/tasks/status?id=${encodeURIComponent(id)}`);
    };

    q('cpSessionDelete').onclick = () => {
      const sid = q('cpSessionDeleteId').value.trim();
      if (!sid) return;
      runControlPlaneRequest('DELETE', `/api/sessions/${encodeURIComponent(sid)}`);
    };

    q('cpSessionClearKeepBtn').onclick = () =>
      runControlPlaneRequest('POST', '/api/sessions/clear', { keepSessionId: q('cpSessionClearKeep').value.trim() });

    q('cpSessionClearAllBtn').onclick = () =>
      runControlPlaneRequest('POST', '/api/sessions/clear', { force: true, keepSessionId: '' });

    q('cpRun').onclick = async () => {
      const method = q('cpMethod').value;
      const path = q('cpPath').value.trim();
      if (!path) return;
      const parsed = parseControlPlaneBody(method, q('cpBody').value);
      if (!parsed.ok) {
        q('cpStatus').textContent = parsed.error;
        return;
      }
      await runControlPlaneRequest(method, path, parsed.body);
    };
  }

  return {
    runControlPlaneRequest,
    bindControlPlaneActions
  };
}
