export function createChatRenderer({
  chat,
  escapeHtml,
  bindPersistentDetailPanels,
  detailPanelKey,
  getDetailPanelState,
  rememberDetailPanelState,
  getSessionId
}) {
  function pushMsg(role, text, html) {
    const wrap = document.createElement('div');
    wrap.className = `bubble-wrap ${role === 'user' ? 'user' : 'ai'}`;
    const bubble = document.createElement('div');
    bubble.className = `bubble ${role === 'user' ? 'user' : 'ai'}`;
    bubble.innerHTML = html || escapeHtml(text || '');
    bindPersistentDetailPanels(bubble, getDetailPanelState(), rememberDetailPanelState);
    wrap.appendChild(bubble);
    chat.appendChild(wrap);
    chat.scrollTop = chat.scrollHeight;
    return { wrap, bubble };
  }

  function appendTypingBubble() {
    const node = pushMsg('assistant', '');
    node.liveEvents = [];
    node.pollCount = 0;
    node.lastToolCount = 0;
    node.lastStep = '';
    node.persistScope = `session:${getSessionId()}:live`;
    node.bubble.innerHTML = `<div class="typing" aria-label="Agent is working">
      <div class="typing-head">
        <span class="typing-label">Agent Running</span>
        <span class="roman-runner" aria-hidden="true"><span>I</span><span>II</span><span>III</span><span>IV</span><span>V</span></span>
      </div>
      <div class="typing-status">Preparing execution...</div>
      <div class="typing-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    </div>`;
    return node;
  }

  function addLiveEvent(typing, text) {
    const at = new Date().toLocaleTimeString();
    typing.liveEvents = typing.liveEvents || [];
    typing.liveEvents.push(`[${at}] ${text}`);
    if (typing.liveEvents.length > 30) {
      typing.liveEvents = typing.liveEvents.slice(-30);
    }
  }

  function renderLiveBubble(typing, statusText, tools = []) {
    const sessionId = getSessionId();
    const scope = typing.persistScope || sessionId || 'pending';
    const events = (typing.liveEvents || [])
      .slice(-16)
      .map((e) => `<div class="trace-line">${escapeHtml(e)}</div>`)
      .join('');
    const lastTools = (tools || [])
      .slice(-8)
      .map((t) => {
        const args = escapeHtml(JSON.stringify(t.args || {}));
        const res = escapeHtml(JSON.stringify(t.result || {}));
        return `<div class="trace-line">tool: ${escapeHtml(t.toolName)} args=${args}</div><div class="trace-line">result: ${res}</div>`;
      })
      .join('');
    typing.bubble.innerHTML = `<div class="typing">
      <div class="typing-head">
        <span class="typing-label">Agent Running</span>
        <span class="roman-runner" aria-hidden="true"><span>I</span><span>II</span><span>III</span><span>IV</span><span>V</span></span>
      </div>
      <div class="typing-status">${escapeHtml(statusText || 'Agent is working...')}</div>
    </div>
      <details class="trace" open data-persist-key="${escapeHtml(detailPanelKey(scope || sessionId || 'global', 'live-activity'))}">
        <summary>Live Activity (${tools.length} tool calls)</summary>
        <div class="trace-body">${lastTools || '<div class="trace-line">No tool call observed yet.</div>'}</div>
      </details>
      <details class="trace" data-persist-key="${escapeHtml(detailPanelKey(scope || sessionId || 'global', 'live-retries'))}">
        <summary>Attempts & Retries (${(typing.liveEvents || []).length})</summary>
        <div class="trace-body">${events || '<div class="trace-line">No events yet.</div>'}</div>
      </details>`;
    bindPersistentDetailPanels(typing.bubble, getDetailPanelState(), rememberDetailPanelState);
  }

  function renderTrace(trace) {
    const sessionId = getSessionId();
    if (!trace || (!Array.isArray(trace.iterations) && !trace.failures)) return '';
    const details = document.createElement('details');
    details.className = 'trace';
    details.dataset.persistKey = detailPanelKey(sessionId || 'session', 'execution-trace');
    const summary = document.createElement('summary');
    const iterCount = Array.isArray(trace.iterations) ? trace.iterations.length : 0;
    summary.textContent = `Execution trace (${iterCount} steps)`;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'trace-body';

    const meta = document.createElement('div');
    meta.className = 'trace-line';
    meta.textContent = `provider/model: ${trace.provider || '-'} / ${trace.model || '-'}`;
    body.appendChild(meta);

    if (Array.isArray(trace.routedTools) && trace.routedTools.length > 0) {
      const routed = document.createElement('div');
      routed.className = 'trace-line';
      routed.textContent = `routed tools: ${trace.routedTools.map((item) => item.tool || item).join(', ')}`;
      body.appendChild(routed);
    }

    if (trace.turnSummary) {
      const turnSummary = document.createElement('div');
      turnSummary.className = 'trace-line';
      turnSummary.textContent =
        `summary: toolRuns=${trace.turnSummary.toolRuns || 0} iterations=${trace.turnSummary.iterationCount || 0} permissionDenials=${trace.turnSummary.permissionDenials || 0} answerShape=${trace.turnSummary.answerShape || '-'} answerScore=${trace.turnSummary.answerScore || 0}`;
      body.appendChild(turnSummary);
    }

    if (trace.answerAssessment) {
      const qa = document.createElement('div');
      qa.className = `trace-quality ${trace.answerAssessment.score >= 80 ? 'good' : trace.answerAssessment.score >= 55 ? 'warn' : 'bad'}`;
      qa.innerHTML = `
        <div class="trace-line"><strong>Answer quality</strong>: shape=${escapeHtml(trace.answerAssessment.shape || '-')} score=${escapeHtml(String(trace.answerAssessment.score || 0))} replace=${escapeHtml(String(Boolean(trace.answerAssessment.shouldReplace)))}</div>
        <div class="trace-line">evidenceResources=${escapeHtml(String(trace.answerAssessment.evidenceResourceCount || 0))} evidenceMentions=${escapeHtml(String(trace.answerAssessment.evidenceMentions || 0))}</div>
        ${Array.isArray(trace.answerAssessment.unsupportedIds) && trace.answerAssessment.unsupportedIds.length ? `<div class="trace-line">unsupportedIds=${escapeHtml(trace.answerAssessment.unsupportedIds.join(', '))}</div>` : ''}
      `;
      body.appendChild(qa);
    }

    if (Array.isArray(trace.pivotHints) && trace.pivotHints.length > 0) {
      const pivot = document.createElement('div');
      pivot.className = 'trace-step';
      const title = document.createElement('h5');
      title.textContent = 'Pivot hints';
      pivot.appendChild(title);
      for (const item of trace.pivotHints) {
        const line = document.createElement('div');
        line.className = 'trace-line';
        line.textContent = item;
        pivot.appendChild(line);
      }
      body.appendChild(pivot);
    }

    for (const it of trace.iterations || []) {
      const step = document.createElement('div');
      step.className = 'trace-step';
      const title = document.createElement('h5');
      title.textContent = `Step ${it.step}`;
      step.appendChild(title);

      if (it.assistantText) {
        const line = document.createElement('div');
        line.className = 'trace-line';
        line.textContent = `assistant: ${it.assistantText}`;
        step.appendChild(line);
      }
      for (const tc of it.toolCalls || []) {
        const l1 = document.createElement('div');
        l1.className = 'trace-line';
        l1.textContent = `tool: ${tc.name} args=${JSON.stringify(tc.args || {})}`;
        step.appendChild(l1);
        const l2 = document.createElement('div');
        l2.className = 'trace-line';
        l2.textContent = `result: ${JSON.stringify(tc.result || {})}`;
        step.appendChild(l2);
      }
      body.appendChild(step);
    }

    if (Array.isArray(trace.failures) && trace.failures.length > 0) {
      const fail = document.createElement('div');
      fail.className = 'trace-step';
      const title = document.createElement('h5');
      title.textContent = 'Provider failures';
      fail.appendChild(title);
      for (const f of trace.failures) {
        const line = document.createElement('div');
        line.className = 'trace-line';
        line.textContent = f;
        fail.appendChild(line);
      }
      body.appendChild(fail);
    }

    if (Array.isArray(trace.permissionDenials) && trace.permissionDenials.length > 0) {
      const denied = document.createElement('div');
      denied.className = 'trace-step';
      const title = document.createElement('h5');
      title.textContent = 'Permission denials';
      denied.appendChild(title);
      for (const item of trace.permissionDenials) {
        const line = document.createElement('div');
        line.className = 'trace-line';
        line.textContent = `${item.tool}: ${item.reason}${item.detail ? ` | ${item.detail}` : ''}`;
        denied.appendChild(line);
      }
      body.appendChild(denied);
    }

    details.appendChild(body);
    return details.outerHTML;
  }

  return {
    pushMsg,
    appendTypingBubble,
    addLiveEvent,
    renderLiveBubble,
    renderTrace
  };
}
