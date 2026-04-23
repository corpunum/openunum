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
    node.streamingTokens = '';
    node.streamingReasoning = '';
    node.reasoningOpen = false;
    node.toolCalls = [];
    node.persistScope = `session:${getSessionId()}:live`;
    // Attach streaming methods to the node so the pending controller can call them
    node.appendTokenToBubble = (token) => appendTokenToBubble(node, token);
    node.appendReasoningToken = (token) => appendReasoningToken(node, token);
    node.addToolCallEvent = (event) => addToolCallToBubble(node, event);
    node.bubble.innerHTML = `<div class="typing" aria-label="Agent is working">
      <div class="typing-head">
        <img src="/ui/icons/unum_working.gif" alt="" class="typing-indicator-gif" />
        <span class="typing-label">Agent Running</span>
        <span class="roman-runner" aria-hidden="true"><span>I</span><span>II</span><span>III</span><span>IV</span><span>V</span></span>
      </div>
      <div class="typing-status">Preparing execution...</div>
      <div class="typing-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    </div>`;
    return node;
  }

  function appendTokenToBubble(typing, token) {
    if (!typing || !typing.bubble) return;
    typing.streamingTokens = (typing.streamingTokens || '') + token;
    const content = typing.streamingTokens;

    const container = typing.bubble.querySelector('.stream-content');
    if (container) {
      container.textContent = content;
      // Auto-scroll the chat
      chat.scrollTop = chat.scrollHeight;
      return;
    }

    // First token: transition from typing indicator to streaming view
    renderStreamingBubble(typing, content);
  }

  function appendReasoningToken(typing, token) {
    if (!typing || !typing.bubble) return;
    typing.streamingReasoning = (typing.streamingReasoning || '') + token;

    const reasoningEl = typing.bubble.querySelector('.reasoning-content');
    if (reasoningEl) {
      reasoningEl.textContent = typing.streamingReasoning;
      return;
    }

    // First reasoning token: show reasoning section
    renderStreamingBubble(typing, typing.streamingTokens || '', typing.streamingReasoning);
  }

  function renderStreamingBubble(typing, content, reasoning) {
    const sessionId = getSessionId();
    const scope = typing.persistScope || sessionId || 'pending';
    const toolDetails = buildToolDetailsHTML(typing);

    let reasoningHTML = '';
    if (reasoning) {
      reasoningHTML = `<details class="reasoning${typing.reasoningOpen ? ' open' : ''}" data-persist-key="${escapeHtml(detailPanelKey(scope, 'reasoning'))}">
        <summary>Thinking&hellip;</summary>
        <div class="reasoning-content">${escapeHtml(reasoning)}</div>
      </details>`;
    }

    typing.bubble.innerHTML = `<div class="streaming-bubble">
      ${reasoningHTML}
      <div class="stream-content">${escapeHtml(content || '')}</div>
      <span class="cursor-blink" aria-hidden="true">&#x2588;</span>
    </div>
    ${toolDetails}`;

    // Restore reasoning open state from persistence
    bindPersistentDetailPanels(typing.bubble, getDetailPanelState(), rememberDetailPanelState);
    chat.scrollTop = chat.scrollHeight;
  }

  function buildToolDetailsHTML(typing) {
    const toolCalls = typing.toolCalls || [];
    if (toolCalls.length === 0) return '';

    const sessionId = getSessionId();
    const scope = typing.persistScope || sessionId || 'pending';
    const items = toolCalls.map((tc, idx) => {
      const statusClass = tc.status === 'completed' ? 'tool-ok' : tc.status === 'failed' ? 'tool-err' : 'tool-running';
      const statusIcon = tc.status === 'completed' ? '&#x2713;' : tc.status === 'failed' ? '&#x2717;' : '&#x25B6;';
      const argsSummary = summarizeToolArgs(tc.args, tc.name);
      const resultSummary = tc.status === 'completed' ? summarizeResult(tc.result) : tc.status === 'failed' ? escapeHtml(tc.error || 'failed') : '';
      return `<div class="tool-call-item ${statusClass}">
        <div class="tool-call-header"><span class="tool-status-icon">${statusIcon}</span> <span class="tool-name">${escapeHtml(tc.name)}</span> <span class="tool-args-summary">${escapeHtml(argsSummary)}</span></div>
        ${resultSummary ? `<div class="tool-result-summary">${resultSummary}</div>` : ''}
        <details class="tool-call-raw" data-persist-key="${escapeHtml(detailPanelKey(scope, `tool-${idx}-${tc.name}`))}">
          <summary>Show details</summary>
          <div class="tool-call-detail"><div class="trace-line">args: ${escapeHtml(JSON.stringify(tc.args || {}, null, 2))}</div>${tc.result ? `<div class="trace-line">result: ${escapeHtml(JSON.stringify(tc.result, null, 2).slice(0, 2000))}</div>` : ''}${tc.error ? `<div class="trace-line">error: ${escapeHtml(tc.error)}</div>` : ''}</div>
        </details>
      </div>`;
    }).join('');

    return `<details class="trace tool-calls-trace" data-persist-key="${escapeHtml(detailPanelKey(scope, 'streaming-tools'))}">
      <summary>Tool Calls (${toolCalls.length})</summary>
      <div class="trace-body">${items}</div>
    </details>`;
  }

  function summarizeToolArgs(args, name) {
    if (!args || typeof args !== 'object') return '';
    const keys = Object.keys(args);
    if (keys.length === 0) return '{}';
    if (keys.length <= 3) {
      const preview = keys.map((k) => {
        const v = String(args[k]);
        return `${k}=${v.length > 40 ? v.slice(0, 37) + '...' : v}`;
      }).join(', ');
      return preview.length > 120 ? preview.slice(0, 117) + '...' : preview;
    }
    return `${keys.length} params`;
  }

  function summarizeResult(result) {
    if (!result) return '';
    if (result.ok === false) return `<span class="tool-err">${escapeHtml(result.error || 'failed')}</span>`;
    if (typeof result.content === 'string') return escapeHtml(result.content.slice(0, 200));
    const json = JSON.stringify(result);
    return escapeHtml(json.slice(0, 200));
  }

  function addToolCallToBubble(typing, event) {
    if (!typing || !typing.bubble) return;
    typing.toolCalls = typing.toolCalls || [];
    if (event.type === 'started') {
      typing.toolCalls.push({ name: event.tool, args: event.args, status: 'running', step: event.step });
    } else if (event.type === 'completed') {
      const existing = typing.toolCalls.find((tc) => tc.name === event.tool && tc.status === 'running');
      if (existing) { existing.status = 'completed'; existing.result = event.result; }
      else { typing.toolCalls.push({ name: event.tool, status: 'completed', step: event.step }); }
    } else if (event.type === 'failed') {
      const existing = typing.toolCalls.find((tc) => tc.name === event.tool && tc.status === 'running');
      if (existing) { existing.status = 'failed'; existing.error = event.error; }
      else { typing.toolCalls.push({ name: event.tool, status: 'failed', error: event.error, step: event.step }); }
    }
    // Re-render the bubble with tool details
    const hasContent = (typing.streamingTokens || '').length > 0;
    if (hasContent) {
      renderStreamingBubble(typing, typing.streamingTokens, typing.streamingReasoning);
    } else {
      // Still in pre-stream phase: update live activity
      const statusText = `Running ${event.tool}...`;
      renderLiveBubble(typing, statusText, []);
    }
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
        <img src="/ui/icons/unum_processing.gif" alt="" class="typing-indicator-gif" />
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

  function finalizeStreamingBubble(typing, html, reasoningHtml) {
    if (!typing || !typing.bubble) return;
    const sessionId = getSessionId();
    const scope = typing.persistScope || sessionId || 'pending';

    let reasoningSection = '';
    if (reasoningHtml) {
      reasoningSection = `<details class="reasoning" data-persist-key="${escapeHtml(detailPanelKey(scope, 'reasoning'))}">
        <summary>Thinking</summary>
        <div class="reasoning-content">${reasoningHtml}</div>
      </details>`;
    }

    typing.bubble.innerHTML = `${reasoningSection}${html}`;
    bindPersistentDetailPanels(typing.bubble, getDetailPanelState(), rememberDetailPanelState);
    chat.scrollTop = chat.scrollHeight;
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

  function renderImageAttachments(imageFiles) {
    if (!Array.isArray(imageFiles) || imageFiles.length === 0) return '';
    return imageFiles.map(({ filename, width, height }) => {
      const url = `/api/assets/${encodeURIComponent(filename)}`;
      return `<div class="image-attachment">
        <a href="${url}" target="_blank" rel="noopener noreferrer">
          <img src="${url}" alt="Generated image" class="generated-image" loading="lazy" onload="this.style.backgroundImage='none';this.style.minHeight='auto'" />
        </a>
        <div class="image-attachment-actions">
          <a href="${url}" download="${escapeHtml(filename)}" class="image-download-btn" title="Download"><img src="/ui/icons/unum_downloading.gif" alt="" class="dl-icon" />Download</a>
        </div>
      </div>`;
    }).join('');
  }

  return {
    pushMsg,
    appendTypingBubble,
    addLiveEvent,
    renderLiveBubble,
    renderTrace,
    appendTokenToBubble,
    appendReasoningToken,
    addToolCallToBubble,
    finalizeStreamingBubble,
    renderImageAttachments
  };
}
