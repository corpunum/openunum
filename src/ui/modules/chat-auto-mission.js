export function createAutoMissionRunner({
  q,
  jpost,
  jget,
  sleep,
  addLiveEvent,
  renderLiveBubble,
  escapeHtml,
  getLocationOrigin
}) {
  async function runAutoMissionFromChat(rawMessage, typing) {
    const goal = String(rawMessage || '').replace(/^\/auto\s*/i, '').trim();
    if (!goal) {
      typing.bubble.textContent = 'Usage: /auto <goal>';
      return;
    }

    let activeTaskId = '';

    const startAutoTask = async () => {
      const started = await jpost('/api/autonomy/tasks/run', {
        goal,
        baseUrl: getLocationOrigin(),
        runtime: {
          missionDefaultHardStepCap: Number(q('missionSteps').value || 6),
          missionDefaultIntervalMs: Number(q('missionInterval').value || 400),
          missionDefaultMaxRetries: 8
        },
        missionTimeoutMs: 20 * 60 * 1000
      });
      activeTaskId = started.task.id;
      addLiveEvent(typing, `task started: ${activeTaskId}`);
    };

    await startAutoTask();

    const deadline = Date.now() + 60 * 60 * 1000;
    let recoveries = 0;
    while (Date.now() < deadline) {
      await sleep(2000);
      const out = await jget(`/api/autonomy/tasks/status?id=${encodeURIComponent(activeTaskId)}`);
      if (out.error) {
        if (out.error === 'task_not_found' && recoveries < 2) {
          recoveries += 1;
          addLiveEvent(typing, `task_not_found; auto-recover ${recoveries}/2`);
          renderLiveBubble(typing, `Task handle lost. Auto-recovering... (${recoveries}/2)`, []);
          await startAutoTask();
          continue;
        }
        addLiveEvent(typing, `task error: ${out.error}`);
        typing.bubble.textContent = `auto task error: ${out.error}`;
        return;
      }
      const task = out.task;
      const latest = Array.isArray(task.stepResults) ? task.stepResults[task.stepResults.length - 1] : null;
      const preview = latest?.result?.error || latest?.kind || 'working...';
      const completedSteps = Array.isArray(task.plan)
        ? task.plan.filter((item) => item.status === 'completed').length
        : 0;
      const stepKey = `${task.status}:${completedSteps}`;
      if (typing.lastStep !== stepKey) {
        typing.lastStep = stepKey;
        addLiveEvent(typing, `task status=${task.status} completed=${completedSteps}`);
      }
      const taskToolLike = latest ? [{ toolName: `task.${latest.kind}`, args: { status: task.status }, result: { preview } }] : [];
      renderLiveBubble(
        typing,
        `auto task ${task.id} status=${task.status} completed=${completedSteps}/${task.plan?.length || task.steps?.length || 0}`,
        taskToolLike
      );
      if (task.status !== 'running') {
        addLiveEvent(typing, `task terminal status: ${task.status}`);
        const verificationSummary = (task.verification || [])
          .map((item) => `${item.label || item.kind}: ${item.ok ? 'ok' : 'failed'}`)
          .join('\n');
        typing.bubble.innerHTML = `<pre>${escapeHtml(`Autonomous task ${task.id} ended: ${task.status}\n\n${verificationSummary || preview}`)}</pre>`;
        return;
      }
    }
    typing.bubble.textContent = 'Auto task is still running in background.';
  }

  return {
    runAutoMissionFromChat
  };
}
