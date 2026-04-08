import { q, qa, escapeHtml, sleep } from './modules/dom.js';
import { jget, jpost, jrequest } from './modules/http.js';
import { setStatus } from './modules/feedback.js';
import { showView as showViewWithMeta } from './modules/navigation.js';
import {
  loadDetailPanelState,
  detailPanelKey,
  rememberDetailPanelState as rememberDetailPanelStateWithStorage,
  bindPersistentDetailPanels
} from './modules/detail-panels.js';
import {
  pendingPollDelayMs,
  formatRelativeTime,
  newestAssistantSince,
  shouldEscalateToAuto,
  isStatusCheckMessage,
  isPlanningReply,
  formatProviderModel,
  stripProviderPrefix
} from './modules/logic.js';

const VIEW_META = {
  chat: ['Chat Terminal', 'Autonomous agent conversation'],
  'operator': ['Execution Trace', 'Runtime, tools, and live execution state'],
  'model-routing': ['Model Routing', 'Primary model selection and fallback strategy'],
  'provider-config': ['Provider Vault', 'Provider matrix, models, and secure auth vault'],
  'browser': ['Browser Ops', 'Browser and hardware control'],
  'telegram': ['Telegram Bridge', 'Channel connectivity and polling control'],
  'missions': ['Mission Runner', 'Autonomous execution loops'],
  'control-plane': ['Control Plane API', 'Backend operations and full API access']
};

let MODEL_PROVIDER_IDS = ['ollama-local', 'ollama-cloud', 'nvidia', 'openrouter', 'xiaomimimo', 'openai'];
let SERVICE_PROVIDER_IDS = ['github', 'google-workspace', 'huggingface', 'elevenlabs', 'telegram', 'openai-oauth', 'github-copilot'];
const SERVICE_SECRET_FIELD = {
  github: 'githubToken',
  'google-workspace': '',
  huggingface: 'huggingfaceApiKey',
  elevenlabs: 'elevenlabsApiKey',
  telegram: 'telegramBotToken',
  'openai-oauth': 'openaiOauthToken',
  'github-copilot': 'copilotGithubToken'
};
const PROVIDER_SECRET_FIELD = {
  'ollama-local': '',
  'ollama-cloud': '',
  nvidia: 'nvidiaApiKey',
  openrouter: 'openrouterApiKey',
  xiaomimimo: 'xiaomimimoApiKey',
  openai: 'openaiApiKey'
};
const PROVIDER_BASE_FIELD = {
  'ollama-local': 'ollamaBaseUrl',
  'ollama-cloud': 'ollamaBaseUrl',
  nvidia: 'nvidiaBaseUrl',
  openrouter: 'openrouterBaseUrl',
  xiaomimimo: 'xiaomimimoBaseUrl',
  openai: 'openaiBaseUrl'
};

let sessionId = localStorage.getItem('openunum_session') || crypto.randomUUID();
let activeMissionId = localStorage.getItem('openunum_mission') || '';
let lastTaskPrompt = localStorage.getItem('openunum_last_task_prompt') || '';
let autoEscalateEnabled = localStorage.getItem('openunum_auto_escalate');
if (autoEscalateEnabled == null) autoEscalateEnabled = 'true';
autoEscalateEnabled = autoEscalateEnabled === 'true';
let liveActivityEnabled = localStorage.getItem('openunum_live_activity');
if (liveActivityEnabled == null) liveActivityEnabled = 'true';
liveActivityEnabled = liveActivityEnabled === 'true';
localStorage.setItem('openunum_session', sessionId);

const topStatus = q('topStatus');
const chat = q('chat');
const sessionListEl = q('sessionList');
let sessionCache = [];
let modelCatalog = null;
let authCatalog = null;
let runtimeOverview = null;
let missionTimelineCache = null;
let sessionLoadToken = 0;
let requestTokenSeq = 0;
const pendingSessions = new Set();
let fallbackSequence = [];
let providerAdvancedOpen = {};
let serviceAdvancedOpen = {};
let runtimeConfigCache = null;
let lastMissionList = [];
const vaultModalState = { kind: '', id: '' };
let hiddenProviderRows = [];
let hiddenServiceRows = [];
let authJobPrompted = {};
let detailPanelState = loadDetailPanelState(localStorage);
q('chatMeta').textContent = sessionId;
q('autoEscalateToggle').textContent = `Auto: ${autoEscalateEnabled ? 'On' : 'Off'}`;
q('liveActivityToggle').textContent = `Live: ${liveActivityEnabled ? 'On' : 'Off'}`;
function isCurrentSessionPending() {
  return pendingSessions.has(sessionId);
}
function updateComposerPendingState() {
  const pending = isCurrentSessionPending();
  q('send').disabled = pending;
  q('message').placeholder = pending
    ? 'Session is still running. Switch sessions or wait for completion.'
    : 'Type a message. Enter sends, Shift+Enter adds a new line';
}
function rememberDetailPanelState(key, patch) {
  rememberDetailPanelStateWithStorage(detailPanelState, key, patch, localStorage);
}

function showView(viewId) {
  showViewWithMeta(viewId, VIEW_META);
}

function renderSessionList() {
  if (!sessionListEl) return;
  sessionListEl.innerHTML = '';
  const query = String(q('sessionSearch')?.value || '').trim().toLowerCase();
  const filteredSessions = !query
    ? sessionCache
    : sessionCache.filter((s) => {
        const haystack = `${s.title || ''} ${s.preview || ''} ${s.sessionId || ''}`.toLowerCase();
        return haystack.includes(query);
      });
  if (!filteredSessions.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = query ? 'No matching sessions' : 'No sessions yet';
    sessionListEl.appendChild(empty);
    return;
  }
  for (const s of filteredSessions) {
    const row = document.createElement('div');
    row.className = 'session-row';
    const itemWrap = document.createElement('div');
    itemWrap.className = 'session-item-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `session-item${s.sessionId === sessionId ? ' active' : ''}`;
    btn.innerHTML = `
      <div class="session-title">${escapeHtml(s.title || 'New Chat')}</div>
      <div class="session-preview">${escapeHtml(s.preview || 'No messages yet')}</div>
      <div class="session-meta">${escapeHtml(formatRelativeTime(s.lastMessageAt || s.createdAt))} · ${Number(s.messageCount || 0)} msgs</div>
    `;
    btn.onclick = async () => switchToSession(s.sessionId);
    itemWrap.appendChild(btn);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'session-delete';
    del.title = 'Delete session';
    del.textContent = 'X';
    del.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const confirmed = confirm(`Delete session ${s.sessionId}?`);
      if (!confirmed) return;
      await jrequest('DELETE', `/api/sessions/${encodeURIComponent(s.sessionId)}`);
      if (s.sessionId === sessionId) {
        await resetSession();
        await refreshContextStatus();
        await refreshTacticalLedger();
      } else {
        await refreshSessionList();
      }
    };

    row.appendChild(itemWrap);
    row.appendChild(del);
    sessionListEl.appendChild(row);
  }
}

q('sessionSearch').addEventListener('input', () => renderSessionList());

async function refreshSessionList() {
  const out = await jget('/api/sessions?limit=120');
  sessionCache = (Array.isArray(out.sessions) ? out.sessions : [])
    .slice()
    .sort((a, b) => {
      const at = Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt || 0) || 0;
      const bt = Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt || 0) || 0;
      return bt - at;
    });
  renderSessionList();
}

async function ensureSessionExists(id) {
  await jpost('/api/sessions', { sessionId: id });
}

function pushMsg(role, text, html) {
  const wrap = document.createElement('div');
  wrap.className = `bubble-wrap ${role === 'user' ? 'user' : 'ai'}`;
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role === 'user' ? 'user' : 'ai'}`;
  bubble.innerHTML = html || escapeHtml(text || '');
  bindPersistentDetailPanels(bubble, detailPanelState, rememberDetailPanelState);
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
  node.persistScope = `session:${sessionId}:live`;
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
  const scope = typing.persistScope || sessionId || 'pending';
  const events = (typing.liveEvents || []).slice(-16).map((e) => `<div class="trace-line">${escapeHtml(e)}</div>`).join('');
  const lastTools = (tools || []).slice(-8).map((t) => {
    const args = escapeHtml(JSON.stringify(t.args || {}));
    const res = escapeHtml(JSON.stringify(t.result || {}));
    return `<div class="trace-line">tool: ${escapeHtml(t.toolName)} args=${args}</div><div class="trace-line">result: ${res}</div>`;
  }).join('');
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
  bindPersistentDetailPanels(typing.bubble, detailPanelState, rememberDetailPanelState);
}

function renderTrace(trace) {
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
    const summary = document.createElement('div');
    summary.className = 'trace-line';
    summary.textContent =
      `summary: toolRuns=${trace.turnSummary.toolRuns || 0} iterations=${trace.turnSummary.iterationCount || 0} permissionDenials=${trace.turnSummary.permissionDenials || 0} answerShape=${trace.turnSummary.answerShape || '-'} answerScore=${trace.turnSummary.answerScore || 0}`;
    body.appendChild(summary);
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

  for (const it of (trace.iterations || [])) {
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
    for (const tc of (it.toolCalls || [])) {
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
      const l = document.createElement('div');
      l.className = 'trace-line';
      l.textContent = f;
      fail.appendChild(l);
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

async function switchToSession(nextSessionId) {
  const target = String(nextSessionId || '').trim();
  if (!target) return;
  sessionId = target;
  localStorage.setItem('openunum_session', sessionId);
  q('chatMeta').textContent = sessionId;
  updateComposerPendingState();
  await ensureSessionExists(sessionId);
  await loadSession(sessionId);
  await refreshContextStatus().catch(() => {});
  await refreshTacticalLedger().catch(() => {});
  renderSessionList();
  showView('chat');
}

async function loadSession(targetSessionId = sessionId) {
  const sid = String(targetSessionId || '').trim();
  const token = ++sessionLoadToken;
  chat.innerHTML = '<div class="hint">Loading session...</div>';
  const out = await jget(`/api/sessions/${encodeURIComponent(sid)}`);
  if (token !== sessionLoadToken || sid !== sessionId) return;
  chat.innerHTML = '';
  for (const m of out.messages || []) {
    pushMsg(m.role === 'assistant' ? 'assistant' : 'user', m.content, m.role === 'assistant' ? m.html : '');
  }
  await resumePendingSessionIfNeeded(sid);
}

async function resetSession() {
  sessionId = crypto.randomUUID();
  localStorage.setItem('openunum_session', sessionId);
  q('chatMeta').textContent = sessionId;
  chat.innerHTML = '';
  updateComposerPendingState();
  await ensureSessionExists(sessionId);
  await refreshSessionList();
}

function buildPendingStatus(typing, activity, pendingState) {
  const toolCount = Array.isArray(activity?.toolRuns) ? activity.toolRuns.length : 0;
  const assistantMsg = newestAssistantSince(activity?.messages || [], activity?.since || pendingState?.startedAt || '');
  if (assistantMsg?.content) return 'Final response ready. Restoring answer...';
  if (!pendingState?.pending && toolCount > 0) return 'Finalizing response...';
  if (toolCount === 0) return 'Routing request...';
  if (typing.pollCount <= 1) return `Executing tools... (${toolCount})`;
  if ((typing.lastToolCount || 0) === toolCount) return 'Waiting for provider response...';
  return `Processing tool results... (${toolCount})`;
}

async function resumePendingSessionIfNeeded(targetSessionId = sessionId) {
  const sid = String(targetSessionId || '').trim();
  if (!sid || sid !== sessionId) return false;
  const activity = await jget(`/api/sessions/${encodeURIComponent(sid)}/activity`);
  if (!activity?.pending || !activity?.pendingStartedAt) {
    pendingSessions.delete(sid);
    updateComposerPendingState();
    return false;
  }
  pendingSessions.add(sid);
  updateComposerPendingState();
  const typing = appendTypingBubble();
  typing.persistScope = `pending:${sid}:${activity.pendingStartedAt}`;
  typing.liveEvents = [`[${new Date().toLocaleTimeString()}] recovered pending run after refresh`];
  typing.lastToolCount = Array.isArray(activity.toolRuns) ? activity.toolRuns.length : 0;
  renderLiveBubble(typing, buildPendingStatus(typing, activity, activity), activity.toolRuns || []);
  const requestToken = ++requestTokenSeq;
  resolvePendingReply(typing, activity.pendingStartedAt, sid, requestToken).catch((error) => {
    typing.bubble.textContent = `Pending recovery failed: ${String(error?.message || error)}`;
  });
  return true;
}

async function resolvePendingReplyViaStream(typing, startedAtIso, requestSessionId, requestToken, deadline) {
  if (typeof EventSource === 'undefined') return null;
  const url = `/api/chat/stream?sessionId=${encodeURIComponent(requestSessionId)}&since=${encodeURIComponent(startedAtIso)}`;
  return await new Promise((resolve) => {
    let settled = false;
    const source = new EventSource(url);
    const cleanup = (result = null) => {
      if (settled) return;
      settled = true;
      try { source.close(); } catch {}
      clearTimeout(timeoutId);
      resolve(result);
    };
    const timeoutMs = Math.max(1000, deadline - Date.now());
    const timeoutId = setTimeout(() => cleanup(null), timeoutMs);

    source.onmessage = (ev) => {
      if (requestToken !== requestTokenSeq) {
        cleanup(false);
        return;
      }
      let payload = null;
      try {
        payload = JSON.parse(String(ev.data || '{}'));
      } catch {
        return;
      }
      typing.pollCount = (typing.pollCount || 0) + 1;
      const tools = Array.isArray(payload?.toolRuns) ? payload.toolRuns : [];
      if ((typing.lastToolCount || 0) !== tools.length) {
        addLiveEvent(typing, `tool count ${typing.lastToolCount || 0} -> ${tools.length}`);
        typing.lastToolCount = tools.length;
      }
      const statusText = buildPendingStatus(typing, payload, {
        pending: Boolean(payload?.pending),
        startedAt: payload?.startedAt || startedAtIso
      });
      const msgFromActivity = newestAssistantSince(payload?.messages || [], startedAtIso);
      if (liveActivityEnabled) {
        renderLiveBubble(typing, statusText, tools);
      } else {
        typing.bubble.textContent = statusText;
      }
      if (msgFromActivity?.content) {
        addLiveEvent(typing, 'assistant final response received');
        typing.bubble.innerHTML = msgFromActivity.html || `<pre>${escapeHtml(msgFromActivity.content)}</pre>`;
        void refreshSessionList();
        cleanup(true);
        return;
      }
      if (payload?.done === true) {
        cleanup(null);
      }
    };

    source.onerror = () => cleanup(null);
  });
}

async function resolvePendingReply(typing, startedAtIso, requestSessionId, requestToken) {
  const deadline = Date.now() + 10 * 60 * 1000;
  pendingSessions.add(requestSessionId);
  updateComposerPendingState();
  try {
    const streamResult = await resolvePendingReplyViaStream(
      typing,
      startedAtIso,
      requestSessionId,
      requestToken,
      deadline
    );
    if (streamResult !== null) return streamResult;

    while (Date.now() < deadline) {
      if ((typing.pollCount || 0) > 0) {
        await sleep(pendingPollDelayMs(typing.pollCount || 0));
      }
      if (requestToken !== requestTokenSeq) return false;
      typing.pollCount = (typing.pollCount || 0) + 1;
      const act = await jget(`/api/sessions/${encodeURIComponent(requestSessionId)}/activity?since=${encodeURIComponent(startedAtIso)}`);
      const tools = Array.isArray(act.toolRuns) ? act.toolRuns : [];
      if ((typing.lastToolCount || 0) !== tools.length) {
        addLiveEvent(typing, `tool count ${typing.lastToolCount || 0} -> ${tools.length}`);
        typing.lastToolCount = tools.length;
      }
      const pendingState = {
        pending: Boolean(act?.pending),
        startedAt: act?.pendingStartedAt || startedAtIso
      };
      const statusText = buildPendingStatus(typing, act, pendingState);
      const msgFromActivity = newestAssistantSince(act.messages || [], startedAtIso);
      if (liveActivityEnabled) {
        renderLiveBubble(typing, statusText, tools);
      } else {
        typing.bubble.textContent = statusText;
      }
      if (msgFromActivity?.content) {
        addLiveEvent(typing, 'assistant final response received');
        typing.bubble.innerHTML = msgFromActivity.html || `<pre>${escapeHtml(msgFromActivity.content)}</pre>`;
        await refreshSessionList();
        return true;
      }
      if (pendingState.pending) continue;
      const out = await jget(`/api/sessions/${encodeURIComponent(requestSessionId)}`);
      const msg = newestAssistantSince(out.messages || [], startedAtIso);
      if (msg?.content) {
        addLiveEvent(typing, 'assistant final response received');
        typing.bubble.innerHTML = msg.html || `<pre>${escapeHtml(msg.content)}</pre>`;
        await refreshSessionList();
        return true;
      }
      addLiveEvent(typing, 'pending ended but no assistant message found yet; reloading session');
      await loadSession(requestSessionId);
      typing.bubble.textContent = 'Agent finished tool work. Waiting for final response persistence.';
      return false;
    }
    addLiveEvent(typing, 'pending deadline reached; run continues in background');
    typing.bubble.textContent = 'Agent is still running in background. You can keep chatting; history is preserved.';
    return false;
  } finally {
    pendingSessions.delete(requestSessionId);
    updateComposerPendingState();
  }
}

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
      baseUrl: location.origin,
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
      typing.bubble.innerHTML = `<pre>${escapeHtml(`Autonomous task ${task.id} ended: ${task.status}

${verificationSummary || preview}`)}</pre>`;
      return;
    }
  }
  typing.bubble.textContent = 'Auto task is still running in background.';
}


function setSelectByValueOrFirst(id, value) {
  const el = q(id);
  if (!el) return;
  if (el.tagName !== 'SELECT') {
    el.value = value ?? '';
    return;
  }
  const options = Array.from(el.options).map((o) => o.value);
  el.value = options.includes(value) ? value : options[0] || '';
}

async function refreshCapabilities() {
  const caps = await jget('/api/capabilities');
  const providers = Array.isArray(caps?.provider_order) ? caps.provider_order : [];
  const services = Array.isArray(caps?.services) ? caps.services : [];
  if (providers.length) {
    MODEL_PROVIDER_IDS = [...new Set(providers.map((p) => String(p || '').trim()).filter(Boolean))];
  }
  if (services.length) {
    SERVICE_PROVIDER_IDS = [...new Set(services.map((s) => String(s || '').trim()).filter(Boolean))];
  }
  renderProviderSelectors();
  normalizeHiddenRows();
  refreshAddRowSelectors();
  return caps;
}

function renderProviderSelectors() {
  const providerSelect = q('provider');
  const fallbackSelect = q('fallbackProviderPicker');
  if (providerSelect) {
    const selected = providerSelect.value;
    providerSelect.innerHTML = MODEL_PROVIDER_IDS
      .map((provider) => `<option value="${provider}">${provider}</option>`)
      .join('');
    setSelectByValueOrFirst('provider', selected || MODEL_PROVIDER_IDS[0] || '');
  }
  if (fallbackSelect) {
    const selected = fallbackSelect.value;
    fallbackSelect.innerHTML = '<option value="">Select provider</option>' + MODEL_PROVIDER_IDS
      .map((provider) => `<option value="${provider}">${provider}</option>`)
      .join('');
    if (selected) fallbackSelect.value = selected;
  }
}

function formatPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${(num * 100).toFixed(1)}%`;
}

function normalizeHiddenRows() {
  hiddenProviderRows = hiddenProviderRows.filter((id, index, arr) => MODEL_PROVIDER_IDS.includes(id) && arr.indexOf(id) === index);
  hiddenServiceRows = hiddenServiceRows.filter((id, index, arr) => SERVICE_PROVIDER_IDS.includes(id) && arr.indexOf(id) === index);
  localStorage.setItem('openunum_hidden_provider_rows', JSON.stringify(hiddenProviderRows));
  localStorage.setItem('openunum_hidden_service_rows', JSON.stringify(hiddenServiceRows));
}

function providerCatalogRow(provider) {
  return (authCatalog?.providers || []).find((row) => row.provider === provider) || null;
}

function catalogModelsForProvider(provider) {
  return modelCatalog?.providers?.find((row) => row.provider === provider)?.models || [];
}

function preferredModelForProvider(provider) {
  const fromConfig = runtimeOverview?.selectedModel?.provider === provider
    ? runtimeOverview.selectedModel.model_id
    : null;
  if (fromConfig) return fromConfig;
  const row = providerCatalogRow(provider);
  if (row?.top_model) return row.top_model;
  return catalogModelsForProvider(provider)?.[0]?.model_id || '';
}

function ensureFallbackSequence(primaryProvider) {
  const normalizedPrimary = String(primaryProvider || q('provider')?.value || 'ollama-cloud');
  fallbackSequence = (fallbackSequence || [])
    .map((item) => ({
      provider: item.provider,
      model: item.model || preferredModelForProvider(item.provider)
    }))
    .filter((item, index, arr) => item.provider && item.provider !== normalizedPrimary && arr.findIndex((entry) => entry.provider === item.provider) === index);
}

function buildFallbackModelOptions(provider, selectedModel = '') {
  const models = catalogModelsForProvider(provider);
  return models.map((model) => {
    const modelId = model.model_id || model.id || '';
    return `<option value="${escapeHtml(modelId)}" ${modelId === selectedModel ? 'selected' : ''}>#${Number(model.rank || 0)} ${escapeHtml(modelId)}</option>`;
  }).join('');
}

function renderFallbackSequence() {
  ensureFallbackSequence(q('provider')?.value);
  const body = q('fallbackSequenceBody');
  if (!body) return;
  body.innerHTML = fallbackSequence.map((entry, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>
        <select class="fallback-provider" data-index="${index}">
          ${MODEL_PROVIDER_IDS.filter((provider) => provider === entry.provider || !fallbackSequence.some((item, itemIndex) => item.provider === provider && itemIndex !== index) && provider !== q('provider').value)
            .map((provider) => `<option value="${provider}" ${provider === entry.provider ? 'selected' : ''}>${provider}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="fallback-model" data-index="${index}">
          ${buildFallbackModelOptions(entry.provider, entry.model)}
        </select>
      </td>
      <td>
        <div class="row">
          <button type="button" class="fallback-up" data-index="${index}">Up</button>
          <button type="button" class="fallback-down" data-index="${index}">Down</button>
          <button type="button" class="fallback-remove" data-index="${index}">Remove</button>
        </div>
      </td>
    </tr>
  `).join('');
  if (!fallbackSequence.length) {
    body.innerHTML = '<tr><td colspan="4" class="hint">No explicit fallback rows yet. Use `Auto Fill Best Sequence` or `Add Fallback`.</td></tr>';
  }
  qa('.fallback-provider').forEach((el) => {
    el.onchange = () => {
      const index = Number(el.dataset.index);
      const provider = el.value;
      fallbackSequence[index] = { provider, model: preferredModelForProvider(provider) };
      renderFallbackSequence();
    };
  });
  qa('.fallback-model').forEach((el) => {
    el.onchange = () => {
      const index = Number(el.dataset.index);
      fallbackSequence[index].model = el.value;
    };
  });
  qa('.fallback-up').forEach((btn) => {
    btn.onclick = () => {
      const index = Number(btn.dataset.index);
      if (index <= 0) return;
      const current = fallbackSequence[index];
      fallbackSequence[index] = fallbackSequence[index - 1];
      fallbackSequence[index - 1] = current;
      renderFallbackSequence();
    };
  });
  qa('.fallback-down').forEach((btn) => {
    btn.onclick = () => {
      const index = Number(btn.dataset.index);
      if (index >= fallbackSequence.length - 1) return;
      const current = fallbackSequence[index];
      fallbackSequence[index] = fallbackSequence[index + 1];
      fallbackSequence[index + 1] = current;
      renderFallbackSequence();
    };
  });
  qa('.fallback-remove').forEach((btn) => {
    btn.onclick = () => {
      const index = Number(btn.dataset.index);
      fallbackSequence.splice(index, 1);
      renderFallbackSequence();
    };
  });
}

async function refreshModel() {
  const m = await jget('/api/model/current');
  setSelectByValueOrFirst('provider', m.provider);
  topStatus.textContent = `cfg=${formatProviderModel(m.provider, m.model)} active=${formatProviderModel(m.activeProvider, m.activeModel)}`;
  await loadModelsForProvider(m.provider, m.model);
}

async function refreshModelCatalog() {
  modelCatalog = await jget('/api/model-catalog');
  q('modelCatalogStatus').textContent = `catalog ${modelCatalog.contract_version} | providers=${(modelCatalog.providers || []).length}`;
  renderProviderCards(modelCatalog.providers || []);
  renderFallbackSequence();
  return modelCatalog;
}

function renderProviderCards(providers = []) {
  const host = q('providerCards');
  if (!host) return;
  host.innerHTML = providers.map((provider) => `
    <div class="provider-card ${provider.status}">
      <div class="row" style="justify-content:space-between;">
        <strong>${escapeHtml(provider.display_name || provider.provider)}</strong>
        <span class="pill">${escapeHtml(provider.status)}</span>
      </div>
      <div class="hint" style="margin-top:6px;">#1 ${escapeHtml(provider.models?.[0]?.model_id || '-')}</div>
      <div class="hint">models=${Number(provider.models?.length || 0)}</div>
      ${provider.degraded_reason ? `<div class="hint" style="color:#facc15;">${escapeHtml(provider.degraded_reason)}</div>` : ''}
    </div>
  `).join('');
}

function badgeClassForStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'healthy' || normalized === 'configured' || normalized === 'authenticated') return 'good';
  if (normalized === 'degraded' || normalized === 'partial') return 'warn';
  if (normalized === 'missing' || normalized === 'unavailable') return 'bad';
  return '';
}

function renderStatusBadge(text) {
  const value = String(text || 'unknown');
  return `<span class="badge ${badgeClassForStatus(value)}">${escapeHtml(value)}</span>`;
}

function setFieldMeta(id, info = '') {
  const el = q(id);
  if (el) el.textContent = info;
}

async function runWebuiWireValidation(action = 'mutation') {
  const checks = [];
  try {
    runtimeConfigCache = await jget('/api/config');
    checks.push('config');
  } catch {
    setStatus('providerStatus', `wire validation failed (${action}): config`, { type: 'error', title: 'Wire Validation' });
    return false;
  }
  try {
    await refreshModelCatalog();
    checks.push('model-catalog');
  } catch {
    setStatus('providerStatus', `wire validation failed (${action}): model-catalog`, { type: 'error', title: 'Wire Validation' });
    return false;
  }
  try {
    await refreshAuthCatalog();
    checks.push('auth-catalog');
  } catch {
    setStatus('providerStatus', `wire validation failed (${action}): auth-catalog`, { type: 'error', title: 'Wire Validation' });
    return false;
  }
  try {
    await refreshRuntimeOverview();
    checks.push('runtime');
  } catch {
    setStatus('providerStatus', `wire validation failed (${action}): runtime`, { type: 'error', title: 'Wire Validation' });
    return false;
  }
  setStatus('providerStatus', `wire validation ok (${action}) | ${checks.join(', ')}`, {
    toast: false,
    type: 'success',
    title: 'Wire Validation'
  });
  return true;
}

function providerSummaryText(provider) {
  const parts = [];
  if (provider.top_model) parts.push(`#1 ${provider.top_model}`);
  parts.push(`${Number(provider.model_count || 0)} models`);
  if (provider.base_url) parts.push(provider.base_url.replace(/^https?:\/\//, ''));
  return parts.join(' | ');
}

function serviceSummaryText(row) {
  const parts = [];
  if (row.id === 'google-workspace' && row.oauth_client_id_preview) parts.push(`client ${row.oauth_client_id_preview}`);
  if (row.cli?.account) parts.push(row.cli.account);
  else if (row.stored_preview) parts.push(`stored ${row.stored_preview}`);
  else if (row.discovered_source) parts.push('discovered locally');
  else if (row.cli?.available) parts.push('ready to connect');
  else parts.push('manual setup');
  if (row.cli?.detail && !row.cli?.authenticated && !row.cli?.available) parts.push(row.cli.detail);
  return parts.join(' | ');
}

function renderProviderMatrix(providers = []) {
  const host = q('providerMatrixBody');
  if (!host) return;
  const visibleRows = providers.filter((provider) => !hiddenProviderRows.includes(provider.provider));
  host.innerHTML = visibleRows.flatMap((provider) => {
    const authField = PROVIDER_SECRET_FIELD[provider.provider];
    const advancedOpen = Boolean(providerAdvancedOpen[provider.provider]);
    const isDisabled = Boolean(provider.disabled);
    const authPlaceholder = String(provider.provider || '').startsWith('ollama-')
      ? 'local/no key'
      : provider.provider === 'nvidia'
        ? 'nvapi-...'
        : provider.provider === 'openrouter'
          ? 'sk-or-...'
          : provider.provider === 'xiaomimimo'
            ? 'sk-...'
          : 'sk-...';
    const inputPlaceholder = provider.stored_preview
      ? `current ${provider.stored_preview}`
      : (provider.discovered_source ? 'discovered locally' : authPlaceholder);
    const rowOpacity = isDisabled ? 'style="opacity: 0.5;"' : '';
    const disabledBadge = isDisabled ? '<span class="badge" style="background: #333; border-color: #666; color: #999; margin-left: 8px;">DISABLED</span>' : '';
    const mainRow = `
      <tr ${rowOpacity}>
        <td>
          <div class="summary-stack">
            <div class="summary-line"><strong>${escapeHtml(provider.display_name || provider.provider)}</strong>${disabledBadge}</div>
            <div class="summary-sub provider-open" data-provider="${provider.provider}" style="cursor:pointer;text-decoration:underline;">${escapeHtml(provider.provider)}</div>
          </div>
        </td>
        <td>${renderStatusBadge(provider.status || 'unknown')}</td>
        <td>
          ${authField ? `<input class="provider-secret-input" data-provider="${provider.provider}" placeholder="${escapeHtml(inputPlaceholder)}" value="" />` : '<span class="pill">local</span>'}
          <div class="hint" style="margin-top:6px;">${provider.auth_ready ? 'ready' : 'not ready'}${provider.discovered_source ? ` | ${escapeHtml(provider.discovered_source)}` : ''}</div>
        </td>
        <td>
          <div class="summary-stack">
            <div class="summary-line">${escapeHtml(providerSummaryText(provider))}</div>
            <div class="summary-sub">${provider.degraded_reason ? escapeHtml(provider.degraded_reason) : 'catalog available'}</div>
          </div>
        </td>
        <td>
          <div class="row compact-actions">
            <button type="button" class="provider-save" data-provider="${provider.provider}">Save</button>
            <button type="button" class="provider-test" data-provider="${provider.provider}">Test</button>
            <button type="button" class="provider-disable" data-provider="${provider.provider}" style="background-color: ${provider.disabled ? '#555' : '#822'}; color: white;">${provider.disabled ? 'Enable' : 'Disable'}</button>
            <button type="button" class="provider-use" data-provider="${provider.provider}">Use</button>
            <button type="button" class="provider-modal" data-provider="${provider.provider}">Edit Vault</button>
            <button type="button" class="provider-delete" data-provider="${provider.provider}">Remove</button>
            <button type="button" class="provider-advanced" data-provider="${provider.provider}">${advancedOpen ? 'Hide' : 'Edit'}</button>
            <button type="button" class="provider-hide" data-provider="${provider.provider}">Hide</button>
          </div>
        </td>
      </tr>`;
    const detailRow = advancedOpen ? `
      <tr>
        <td colspan="5">
          <div class="soft-panel grid two">
            <div class="field">
              <label>Resolved Base URL</label>
              <input class="provider-base-input mono" data-provider="${provider.provider}" value="${escapeHtml(provider.base_url || '')}" />
            </div>
            <div class="field">
              <label>Discovery / State</label>
              <div class="hint">auth_ready=${provider.auth_ready} | source=${escapeHtml(provider.discovered_source || provider.base_url_source || '-')}</div>
              <div class="hint">${provider.degraded_reason ? escapeHtml(provider.degraded_reason) : 'No degradation detail.'}</div>
            </div>
          </div>
        </td>
      </tr>` : '';
    return [mainRow, detailRow];
  }).join('');
  qa('.provider-save').forEach((btn) => { btn.onclick = () => saveProviderRow(btn.dataset.provider); });
  qa('.provider-test').forEach((btn) => { btn.onclick = () => testProviderRow(btn.dataset.provider); });
  qa('.provider-disable').forEach((btn) => {
    btn.onclick = async () => {
      const provider = btn.dataset.provider;
      const cp = authCatalog.providers.find((p) => p.provider === provider);
      runtimeConfigCache = runtimeConfigCache || await jget('/api/config');
      const existingDisabled = runtimeConfigCache?.model?.routing?.disabledProviders || [];
      const nextDisabled = !cp.disabled;
      await jpost('/api/config', {
        model: {
          routing: {
            disabledProviders: nextDisabled
              ? [...new Set([...existingDisabled, provider])]
              : existingDisabled.filter((p) => p !== provider)
          }
        }
      });
      runtimeConfigCache = null;
      await refreshProviderConfig();
      await refreshModelCatalog();
      await runWebuiWireValidation(`provider_toggle:${provider}`);
    };
  });
  qa('.provider-use').forEach((btn) => {
    btn.onclick = async () => {
      setSelectByValueOrFirst('provider', btn.dataset.provider || 'ollama-cloud');
      await loadModelsForProvider(q('provider').value);
      showView('model-routing');
    };
  });
  qa('.provider-advanced').forEach((btn) => {
    btn.onclick = () => {
      providerAdvancedOpen[btn.dataset.provider] = !providerAdvancedOpen[btn.dataset.provider];
      renderProviderMatrix(authCatalog?.providers || []);
    };
  });
  qa('.provider-modal').forEach((btn) => {
    btn.onclick = () => openVaultModal({ kind: 'provider', id: btn.dataset.provider });
  });
  qa('.provider-open').forEach((btn) => {
    btn.onclick = () => openVaultModal({ kind: 'provider', id: btn.dataset.provider });
  });
  qa('.provider-delete').forEach((btn) => {
    btn.onclick = async () => {
      const provider = String(btn.dataset.provider || '').trim();
      if (!provider) return;
      runtimeConfigCache = runtimeConfigCache || await jget('/api/config');
      const providerModels = { ...(runtimeConfigCache?.model?.providerModels || {}) };
      delete providerModels[provider];
      const fallbackProviders = (runtimeConfigCache?.model?.routing?.fallbackProviders || []).filter((p) => p !== provider);
      const disabledProviders = [...new Set([...(runtimeConfigCache?.model?.routing?.disabledProviders || []), provider])];
      const modelPatch = { providerModels, routing: { fallbackProviders, disabledProviders } };
      if (runtimeConfigCache?.model?.provider === provider) {
        modelPatch.provider = 'ollama-cloud';
        modelPatch.model = stripProviderPrefix(providerModels['ollama-cloud'] || 'minimax-m2.7:cloud', MODEL_PROVIDER_IDS);
      }
      await jpost('/api/config', { model: modelPatch });
      runtimeConfigCache = null;
      setStatus('providerStatus', `removed from routing ${provider}`, { type: 'warn', title: 'Provider Vault' });
      await refreshRuntime();
      await refreshProviderConfig();
      await refreshModelCatalog();
      await runWebuiWireValidation(`provider_remove:${provider}`);
    };
  });
  qa('.provider-hide').forEach((btn) => {
    btn.onclick = () => {
      if (!hiddenProviderRows.includes(btn.dataset.provider)) hiddenProviderRows.push(btn.dataset.provider);
      normalizeHiddenRows();
      refreshAddRowSelectors();
      renderProviderMatrix(authCatalog?.providers || []);
    };
  });
}

function renderAuthMethodTable(rows = []) {
  const host = q('authMethodBody');
  if (!host) return;
  const visibleRows = rows.filter((row) => !hiddenServiceRows.includes(row.id));
  host.innerHTML = visibleRows.flatMap((row) => {
    const advancedOpen = Boolean(serviceAdvancedOpen[row.id]);
    const secretField = SERVICE_SECRET_FIELD[row.id];
    const authCell = secretField
      ? `<input class="service-secret-input" data-service="${row.id}" placeholder="${escapeHtml(row.stored_preview ? `current ${row.stored_preview}` : (row.auth_kind || 'credential'))}" value="" />`
      : `<span class="pill">${escapeHtml(row.cli?.authenticated ? 'oauth active' : row.auth_kind || 'oauth')}</span>`;
    const hasOauth = row.id === 'github' || row.id === 'google-workspace' || row.id === 'openai-oauth';
    const mainRow = `
      <tr>
        <td>
          <div class="summary-stack">
            <div class="summary-line"><strong>${escapeHtml(row.display_name || row.id)}</strong></div>
            <div class="summary-sub">${escapeHtml(row.id)}</div>
          </div>
        </td>
        <td>${renderStatusBadge(row.configured ? 'configured' : (row.cli?.authenticated ? 'authenticated' : (row.cli?.available ? 'available' : 'missing')))}</td>
        <td>
          ${authCell}
          <div class="hint" style="margin-top:6px;">${escapeHtml(serviceSummaryText(row))}</div>
        </td>
        <td>
          <div class="row compact-actions">
            ${secretField ? `<button type="button" class="service-save" data-service="${row.id}">Save</button><button type="button" class="service-test" data-service="${row.id}">Test</button>` : `<button type="button" class="service-test" data-service="${row.id}">Test</button>`}
            ${hasOauth ? `<button type="button" class="service-connect" data-service="${row.id}">Connect</button>` : ''}
            <button type="button" class="service-modal" data-service="${row.id}">Edit Vault</button>
            <button type="button" class="service-delete" data-service="${row.id}">Delete</button>
            <button type="button" class="service-advanced" data-service="${row.id}">${advancedOpen ? 'Hide' : 'Advanced'}</button>
            <button type="button" class="service-hide" data-service="${row.id}">Hide</button>
          </div>
        </td>
      </tr>`;
    const detailRow = advancedOpen ? `
      <tr>
        <td colspan="4">
          <div class="soft-panel">
            ${row.id === 'google-workspace' ? `
              <div class="grid two">
                <div class="field">
                  <label>OAuth Client ID</label>
                  <input class="service-oauth-client-id mono" data-service="${row.id}" value="${escapeHtml(row.oauth_client_id || '')}" placeholder="Google Desktop OAuth Client ID or downloaded OAuth JSON" />
                </div>
                <div class="field">
                  <label>OAuth Client Secret</label>
                  <input class="service-oauth-client-secret mono" data-service="${row.id}" value="" placeholder="${escapeHtml(row.oauth_client_secret_preview ? `current ${row.oauth_client_secret_preview}` : 'optional')}" />
                </div>
              </div>
              <div class="field" style="margin-top:10px;">
                <label>Scopes</label>
                <textarea class="service-oauth-scopes mono" data-service="${row.id}" rows="3">${escapeHtml(row.oauth_scopes || '')}</textarea>
              </div>
            ` : ''}
            <div class="hint">mode=${escapeHtml(row.auth_kind || '-')} | source=${escapeHtml(row.discovered_source || '-')}</div>
            <div class="hint">cli=${escapeHtml(row.cli?.cli || 'n/a')} | detail=${escapeHtml(row.cli?.detail || 'manual')}</div>
          </div>
        </td>
      </tr>` : '';
    return [mainRow, detailRow];
  }).join('');
  qa('.service-save').forEach((btn) => { btn.onclick = () => saveServiceRow(btn.dataset.service); });
  qa('.service-test').forEach((btn) => { btn.onclick = () => testServiceRow(btn.dataset.service); });
  qa('.service-connect').forEach((btn) => { btn.onclick = () => connectServiceRow(btn.dataset.service); });
  qa('.service-modal').forEach((btn) => {
    btn.onclick = () => openVaultModal({ kind: 'service', id: btn.dataset.service });
  });
  qa('.service-delete').forEach((btn) => {
    btn.onclick = async () => {
      const service = String(btn.dataset.service || '').trim();
      const secretField = SERVICE_SECRET_FIELD[service];
      if (!secretField) {
        setStatus('providerStatus', `delete skipped ${service} (oauth/manual only)`, { type: 'warn', title: 'Service Vault' });
        return;
      }
      await jpost('/api/auth/catalog', { clear: [secretField] });
      setStatus('providerStatus', `deleted ${service}`, { type: 'warn', title: 'Service Vault' });
      await refreshProviderConfig();
      await refreshRuntimeOverview();
      await runWebuiWireValidation(`service_delete:${service}`);
    };
  });
  qa('.service-advanced').forEach((btn) => {
    btn.onclick = () => {
      serviceAdvancedOpen[btn.dataset.service] = !serviceAdvancedOpen[btn.dataset.service];
      renderAuthMethodTable(authCatalog?.auth_methods || []);
    };
  });
  qa('.service-hide').forEach((btn) => {
    btn.onclick = () => {
      if (!hiddenServiceRows.includes(btn.dataset.service)) hiddenServiceRows.push(btn.dataset.service);
      normalizeHiddenRows();
      refreshAddRowSelectors();
      renderAuthMethodTable(authCatalog?.auth_methods || []);
    };
  });
}

function authMethodById(id) {
  return (authCatalog?.auth_methods || []).find((row) => row.id === id) || null;
}

function closeVaultModal() {
  const modal = q('vaultEditModal');
  if (!modal) return;
  if (modal.open) modal.close();
  vaultModalState.kind = '';
  vaultModalState.id = '';
}

function openVaultModal({ kind, id }) {
  const modal = q('vaultEditModal');
  const title = q('vaultEditTitle');
  const body = q('vaultEditBody');
  if (!modal || !title || !body) return;
  const safeKind = String(kind || '').trim();
  const safeId = String(id || '').trim();
  if (!safeKind || !safeId) return;
  vaultModalState.kind = safeKind;
  vaultModalState.id = safeId;
  if (safeKind === 'provider') {
    const row = providerCatalogRow(safeId);
    if (!row) return;
    const secretField = PROVIDER_SECRET_FIELD[safeId];
    title.textContent = `Provider Vault: ${safeId}`;
    body.innerHTML = `
      <div class="field">
        <label>Provider ID</label>
        <input id="vaultProviderId" class="mono" value="${escapeHtml(safeId)}" readonly />
      </div>
      <div class="field">
        <label>Base URL</label>
        <input id="vaultProviderBase" class="mono" value="${escapeHtml(row.base_url || '')}" placeholder="https://..." />
      </div>
      ${secretField ? `
        <div class="field">
          <label>API Key / Token</label>
          <input id="vaultProviderSecret" class="mono" value="" placeholder="${escapeHtml(row.stored_preview ? `current ${row.stored_preview}` : 'enter new secret')}" />
        </div>
      ` : ''}
      <div class="field">
        <label>Status</label>
        <input class="mono" value="${escapeHtml(row.status || 'unknown')}" readonly />
      </div>
      <div class="field">
        <label>Top Model</label>
        <input class="mono" value="${escapeHtml(row.top_model || '')}" readonly />
      </div>
    `;
  } else {
    const row = authMethodById(safeId);
    if (!row) return;
    const secretField = SERVICE_SECRET_FIELD[safeId];
    title.textContent = `Service Vault: ${safeId}`;
    body.innerHTML = `
      <div class="field">
        <label>Service ID</label>
        <input class="mono" value="${escapeHtml(safeId)}" readonly />
      </div>
      <div class="field">
        <label>Auth Kind</label>
        <input class="mono" value="${escapeHtml(row.auth_kind || 'unknown')}" readonly />
      </div>
      ${secretField ? `
        <div class="field">
          <label>Secret / Token</label>
          <input id="vaultServiceSecret" class="mono" value="" placeholder="${escapeHtml(row.stored_preview ? `current ${row.stored_preview}` : 'enter new secret')}" />
        </div>
      ` : ''}
      ${safeId === 'google-workspace' ? `
        <div class="field">
          <label>OAuth Client ID</label>
          <input id="vaultGoogleClientId" class="mono" value="${escapeHtml(row.oauth_client_id || '')}" placeholder="google desktop oauth client id" />
        </div>
        <div class="field">
          <label>OAuth Client Secret</label>
          <input id="vaultGoogleClientSecret" class="mono" value="" placeholder="${escapeHtml(row.oauth_client_secret_preview ? `current ${row.oauth_client_secret_preview}` : 'optional')}" />
        </div>
        <div class="field">
          <label>Scopes</label>
          <textarea id="vaultGoogleScopes" class="mono" rows="4">${escapeHtml(row.oauth_scopes || '')}</textarea>
        </div>
      ` : ''}
    `;
  }
  modal.showModal();
}

async function refreshAuthCatalog() {
  try {
    authCatalog = await jget('/api/auth/catalog');
    if (!authCatalog) throw new Error('catalog_is_null');
    
    const providerIds = Array.isArray(authCatalog?.provider_order)
      ? authCatalog.provider_order
      : (authCatalog?.providers || []).map((row) => row.provider);
    if (providerIds?.length) {
      MODEL_PROVIDER_IDS = [...new Set(providerIds.map((id) => String(id || '').trim()).filter(Boolean))];
    }
    const serviceIds = (authCatalog?.auth_targets || authCatalog?.auth_methods || [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean);
    if (serviceIds.length) {
      SERVICE_PROVIDER_IDS = [...new Set(serviceIds)];
    }
    renderProviderSelectors();
    normalizeHiddenRows();
    refreshAddRowSelectors();
    renderProviderMatrix(authCatalog.providers || []);
    renderAuthMethodTable(authCatalog.auth_methods || []);
    const authById = Object.fromEntries((authCatalog.auth_methods || []).map((row) => [row.id, row]));
    const secretStoreBackend = authCatalog.secret_store?.backend || 'plaintext';
    const secretStoreLocked = authCatalog.secret_store?.locked ? 'locked' : 'ready';
    q('providerStatus').setAttribute('data-testid', 'provider-health');
    setStatus(
      'providerStatus',
      `secure store=${authCatalog.secret_store_path || 'unknown'} (${secretStoreBackend}/${secretStoreLocked}) | scanned=${Number(authCatalog.scanned_files?.length || 0)} | github_oauth=${authById.github?.cli?.authenticated ? 'active' : 'inactive'}`,
      { toast: false }
    );
    return authCatalog;
  } catch (err) {
    console.error('refresh_auth_catalog_failed', err);
    setStatus('providerStatus', `catalog failed: ${err.message}`, { type: 'error', title: 'Provider Vault' });
    return null;
  }
}

async function saveVaultModal() {
  if (vaultModalState.kind === 'provider') {
    const provider = vaultModalState.id;
    const row = providerCatalogRow(provider);
    if (!row) return;
    const secretField = PROVIDER_SECRET_FIELD[provider];
    const baseField = PROVIDER_BASE_FIELD[provider];
    const baseValue = q('vaultProviderBase')?.value?.trim() || row.base_url || '';
    const secretValue = q('vaultProviderSecret')?.value?.trim() || '';
    const payload = {
      providerBaseUrls: baseField ? { [baseField]: baseValue } : {},
      secrets: secretField && secretValue ? { [secretField]: secretValue } : {}
    };
    await jpost('/api/auth/catalog', payload);
    setStatus('providerStatus', `saved ${provider}`, { type: 'success', title: 'Provider Vault' });
    await refreshProviderConfig();
    await refreshModelCatalog();
    await refreshRuntimeOverview();
    await runWebuiWireValidation(`provider_save:${provider}`);
    closeVaultModal();
    return;
  }
  if (vaultModalState.kind === 'service') {
    const service = vaultModalState.id;
    const secretField = SERVICE_SECRET_FIELD[service];
    if (service === 'google-workspace') {
      const payload = {
        oauthConfig: {
          googleWorkspace: {
            clientId: q('vaultGoogleClientId')?.value?.trim() || '',
            scopes: q('vaultGoogleScopes')?.value?.trim() || ''
          }
        }
      };
      const secret = q('vaultGoogleClientSecret')?.value?.trim() || '';
      if (secret) payload.oauthConfig.googleWorkspace.clientSecret = secret;
      await jpost('/api/auth/catalog', payload);
    } else if (secretField) {
      const secret = q('vaultServiceSecret')?.value?.trim() || '';
      await jpost('/api/auth/catalog', secret ? { secrets: { [secretField]: secret } } : { clear: [secretField] });
    }
    setStatus('providerStatus', `saved ${service}`, { type: 'success', title: 'Service Vault' });
    await refreshProviderConfig();
    await refreshRuntimeOverview();
    await runWebuiWireValidation(`service_save:${service}`);
    closeVaultModal();
  }
}

async function testVaultModal() {
  if (vaultModalState.kind === 'provider') {
    const provider = vaultModalState.id;
    const row = providerCatalogRow(provider);
    if (!row) return;
    const baseUrl = q('vaultProviderBase')?.value?.trim() || row.base_url || '';
    const apiKey = q('vaultProviderSecret')?.value?.trim() || '';
    const out = await jpost('/api/provider/test', { provider, baseUrl, apiKey });
    setStatus(
      'providerStatus',
      out.ok
        ? `test ok ${provider} | models=${Number(out.modelCount || 0)} | top=${out.topModel || '-'}`
        : `test failed ${provider} | ${out.error || 'unknown'}`,
      { type: out.ok ? 'success' : 'error', title: 'Provider Test' }
    );
    return;
  }
  if (vaultModalState.kind === 'service') {
    const service = vaultModalState.id;
    const secret = q('vaultServiceSecret')?.value?.trim() || '';
    const out = await jpost('/api/service/test', { service, secret });
    setStatus(
      'providerStatus',
      out.ok
        ? `test ok ${service}${out.account ? ` | ${out.account}` : ''}${out.modelCount ? ` | models=${Number(out.modelCount)}` : ''}`
        : `test failed ${service} | ${out.error || 'unknown'}`,
      { type: out.ok ? 'success' : 'error', title: 'Service Test' }
    );
  }
}

function refreshAddRowSelectors() {
  const providerSelect = q('providerAddSelect');
  const serviceSelect = q('serviceAddSelect');
  if (providerSelect) {
    providerSelect.innerHTML = '<option value="">Add model provider...</option>' +
      MODEL_PROVIDER_IDS.filter((id) => hiddenProviderRows.includes(id))
        .map((id) => `<option value="${id}">${id}</option>`).join('');
  }
  if (serviceSelect) {
    serviceSelect.innerHTML = '<option value="">Add service...</option>' +
      SERVICE_PROVIDER_IDS.filter((id) => hiddenServiceRows.includes(id))
        .map((id) => `<option value="${id}">${id}</option>`).join('');
  }
}

async function saveProviderRow(provider) {
  const row = providerCatalogRow(provider);
  if (!row) return;
  const secretField = PROVIDER_SECRET_FIELD[provider];
  const baseField = PROVIDER_BASE_FIELD[provider];
  const secretInput = document.querySelector(`.provider-secret-input[data-provider="${provider}"]`);
  const baseInput = document.querySelector(`.provider-base-input[data-provider="${provider}"]`);
  const providerBaseUrls = {};
  if (baseField) providerBaseUrls[baseField] = baseInput?.value?.trim() || row.base_url || '';
  const payload = {
    providerBaseUrls,
    secrets: secretField && secretInput?.value?.trim() ? { [secretField]: secretInput.value.trim() } : {}
  };
  await jpost('/api/auth/catalog', payload);
  setStatus('providerStatus', `saved ${provider}`, { type: 'success', title: 'Provider Vault' });
  await refreshProviderConfig();
  await refreshModelCatalog();
  await refreshRuntimeOverview();
  await runWebuiWireValidation(`provider_save:${provider}`);
}

async function testProviderRow(provider) {
  const row = providerCatalogRow(provider);
  if (!row) return;
  const secretInput = document.querySelector(`.provider-secret-input[data-provider="${provider}"]`);
  const baseInput = document.querySelector(`.provider-base-input[data-provider="${provider}"]`);
  const out = await jpost('/api/provider/test', {
    provider,
    baseUrl: baseInput?.value?.trim() || row.base_url || '',
    apiKey: secretInput?.value?.trim() || ''
  });
  setStatus(
    'providerStatus',
    out.ok
      ? `test ok ${provider} | models=${Number(out.modelCount || 0)} | top=${out.topModel || '-'}`
      : `test failed ${provider} | ${out.error || 'unknown'}`,
    { type: out.ok ? 'success' : 'error', title: 'Provider Test' }
  );
}

async function saveServiceRow(service) {
  const authRow = authMethodById(service);
  if (!authRow) return;
  const secretField = SERVICE_SECRET_FIELD[service];
  if (service === 'google-workspace') {
    const clientId = document.querySelector(`.service-oauth-client-id[data-service="${service}"]`)?.value?.trim() || '';
    const clientSecret = document.querySelector(`.service-oauth-client-secret[data-service="${service}"]`)?.value?.trim() || '';
    const scopes = document.querySelector(`.service-oauth-scopes[data-service="${service}"]`)?.value?.trim() || '';
    const payload = {
      oauthConfig: {
        googleWorkspace: {
          clientId,
          scopes
        }
      }
    };
    if (clientSecret) payload.oauthConfig.googleWorkspace.clientSecret = clientSecret;
    await jpost('/api/auth/catalog', payload);
    setStatus('providerStatus', `saved ${service}`, { type: 'success', title: 'Service Vault' });
    await refreshAuthCatalog();
    await runWebuiWireValidation(`service_save:${service}`);
    return;
  }
  if (!secretField) return;
  const input = document.querySelector(`.service-secret-input[data-service="${service}"]`);
  const secret = input?.value?.trim() || '';
  await jpost('/api/auth/catalog', { secrets: { [secretField]: secret } });
  setStatus('providerStatus', `saved ${service}`, { type: 'success', title: 'Service Vault' });
  await refreshProviderConfig();
  await refreshRuntimeOverview();
  await runWebuiWireValidation(`service_save:${service}`);
}

async function testServiceRow(service) {
  const input = document.querySelector(`.service-secret-input[data-service="${service}"]`);
  const out = await jpost('/api/service/test', { service, secret: input?.value?.trim() || '' });
  setStatus(
    'providerStatus',
    out.ok
      ? `test ok ${service}${out.account ? ` | ${out.account}` : ''}${out.modelCount ? ` | models=${Number(out.modelCount)}` : ''}`
      : `test failed ${service} | ${out.error || out.detail || 'unknown'}`,
    { type: out.ok ? 'success' : 'error', title: 'Service Test' }
  );
}

async function connectServiceRow(service) {
  if (service === 'google-workspace') {
    await saveServiceRow(service);
  }
  const out = await jpost('/api/service/connect', { service });
  if (out.job?.id) {
    setStatus('providerStatus', `oauth started ${service} | waiting for browser sign-in`, { type: 'info', title: 'OAuth' });
    if (out.job.authUrl) {
      try {
        window.open(out.job.authUrl, '_blank', 'noopener');
      } catch {}
    }
    await pollAuthJob(out.job.id, service);
    return;
  }
  setStatus(
    'providerStatus',
    out.started
      ? `oauth started ${service} | launcher=${out.launcher || 'shell'} | command=${out.command}`
      : `oauth unavailable ${service} | ${out.prerequisite || out.error || 'not_supported'}`,
    { type: out.started ? 'info' : 'warn', title: 'OAuth' }
  );
  await refreshAuthCatalog();
}

async function pollAuthJob(jobId, service) {
  authJobPrompted[jobId] = false;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const out = await jget(`/api/auth/job?id=${encodeURIComponent(jobId)}`);
    const job = out.job || {};
    if (job.status === 'awaiting_browser') {
      setStatus('providerStatus', `oauth ${service}: waiting for browser completion`, { toast: false });
      if (job.authUrl && !job.browserOpened) {
        try {
          window.open(job.authUrl, '_blank', 'noopener');
        } catch {}
      }
    } else if (job.status === 'awaiting_input') {
      setStatus('providerStatus', `oauth ${service}: manual code input required`, { type: 'warn', title: 'OAuth' });
      if (!authJobPrompted[jobId]) {
        authJobPrompted[jobId] = true;
        const input = window.prompt(job.promptMessage || 'Paste the authorization code or redirect URL');
        if (input && input.trim()) {
          await jpost('/api/auth/job/input', { id: jobId, input: input.trim() });
        }
      }
    } else if (job.status === 'completed') {
      setStatus(
        'providerStatus',
        `oauth complete ${service}${job.account ? ` | ${job.account}` : ''}`,
        { type: 'success', title: 'OAuth' }
      );
      await refreshAuthCatalog();
      await refreshRuntimeOverview();
      return;
    } else if (job.status === 'failed') {
      setStatus('providerStatus', `oauth failed ${service} | ${job.error || 'unknown'}`, { type: 'error', title: 'OAuth' });
      await refreshAuthCatalog();
      return;
    } else {
      setStatus('providerStatus', `oauth ${service}: ${job.progress || job.status || 'starting'}`, { toast: false });
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  setStatus('providerStatus', `oauth ${service}: timeout waiting for completion`, { type: 'warn', title: 'OAuth' });
}

async function refreshRuntimeOverview() {
  runtimeOverview = await jget('/api/runtime/overview');
  q('runtimeAutonomyValue').textContent = runtimeOverview.autonomyMode || 'autonomy-first';
  q('runtimeWorkspaceMeta').textContent = runtimeOverview.workspaceRoot || '-';

  const git = runtimeOverview.git || {};
  q('gitBranchValue').textContent = git.branch || 'no-git';
  q('gitBranchMeta').textContent = git.ok
    ? `ahead=${git.ahead || 0} behind=${git.behind || 0} modified=${git.modified || 0}`
    : (git.error || 'git unavailable');

  const degraded = (runtimeOverview.providers || []).filter((p) => p.status !== 'healthy');
  const envelope = runtimeOverview.executionEnvelope || {};
  const policy = runtimeOverview.autonomyPolicy || {};
  const unavailableProviders = (runtimeOverview.providerAvailability || []).filter((row) => row.blocked);
  q('runtimeProviderValue').textContent = degraded.length ? `${degraded.length} degraded` : 'healthy';
  q('runtimeProviderMeta').textContent = (runtimeOverview.providers || [])
    .map((p) => `${p.provider}:${p.status}`)
    .join(' | ') || 'No providers';
  if (envelope.tier) {
    q('runtimeProviderMeta').textContent += ` | envelope=${envelope.tier} tools=${Array.isArray(envelope.toolAllowlist) ? envelope.toolAllowlist.length : 'all'} maxIters=${envelope.maxToolIterations || '-'}`;
  }
  q('runtimeProviderMeta').textContent += ` | policy=${policy.mode || 'execute'} selfProtect=${policy.enforceSelfProtection !== false ? 'on' : 'off'}`;
  if (unavailableProviders.length) {
    q('runtimeProviderMeta').textContent += ` | cooldown=${unavailableProviders.map((row) => `${row.provider}:${row.lastFailureKind || 'unknown'}`).join(',')}`;
  }

  const browserInfo = runtimeOverview.browser || {};
  q('browserHealthValue').textContent = browserInfo.ok ? 'Connected' : 'Degraded';
  q('browserHealthMeta').textContent = browserInfo.error || browserInfo.hint || 'CDP reachable';
  q('browserCdpValue').textContent = browserInfo.cdpUrl || q('cdpPreset').value || '-';
  const tabCount = Array.isArray(browserInfo.targets) ? browserInfo.targets.length : 0;
  q('browserTabMeta').textContent = tabCount ? `${tabCount} visible targets` : 'No live target list';
  await refreshPhase0Diagnostics();
  await refreshContextStatus();
}

async function refreshPhase0Diagnostics() {
  const sid = String(sessionId || '').trim() || 'ui-runtime';
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

async function refreshContextStatus() {
  if (!sessionId) return;
  const out = await jget(`/api/context/status?sessionId=${encodeURIComponent(sessionId)}`);
  const budget = out.budget || {};
  q('contextBudgetValue').textContent = `${formatPct(budget.usagePct)} used`;
  q('contextBudgetMeta').textContent =
    `tokens=${Number(out.estimatedTokens || 0)} / limit=${Number(budget.contextLimit || 0)} | msgs=${Number(out.messageCount || 0)} | latest=${out.latestCompaction?.createdAt || 'none'}`;
}

async function refreshTacticalLedger() {
  const out = await jget(`/api/autonomy/insights?sessionId=${encodeURIComponent(sessionId)}`);
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
  if (!activeMissionId) {
    q('missionTimelineSummary').textContent = 'No active mission.';
    q('missionTimelineLog').innerHTML = '';
    q('missionTimelineTools').innerHTML = '';
    q('missionTimelineArtifacts').innerHTML = '';
    missionTimelineCache = null;
    return;
  }
  missionTimelineCache = await jget(`/api/missions/timeline?id=${encodeURIComponent(activeMissionId)}`);
  renderMissionTimeline();
}

function renderMissionTimeline() {
  const out = missionTimelineCache;
  if (!out) return;
  const filter = q('missionTimelineFilter')?.value || 'all';
  const search = String(q('missionTimelineSearch')?.value || '').trim().toLowerCase();
  const match = (text) => !search || String(text || '').toLowerCase().includes(search);

  q('missionTimelineSummary').textContent =
    `status=${out.mission.status} step=${out.mission.step}/${out.mission.hardStepCap || out.mission.maxSteps} retries=${Number(out.mission.retries || 0)} session=${out.mission.sessionId}`;

  const logItems = (out.log || []).slice(-8).reverse()
    .filter((item) => match(`${item.at} ${item.reply || ''} ${item.selfPoke || ''}`))
    .map((item) => `<div class="ledger-item">step ${Number(item.step || 0)} | ${escapeHtml(item.at || '')} | ${escapeHtml(String(item.reply || item.selfPoke || '').slice(0, 180))}</div>`)
    .join('');
  q('missionTimelineLog').innerHTML = (filter === 'all' || filter === 'log')
    ? `<strong>Mission log</strong>${logItems || '<div class="ledger-item">No mission log entries match.</div>'}`
    : '';

  const toolItems = (out.toolRuns || []).slice(-8).reverse()
    .filter((item) => match(`${item.toolName} ${item.createdAt} ${JSON.stringify(item.result || {})}`))
    .map((item) => `<div class="ledger-item">tool ${escapeHtml(item.toolName)} | ok=${escapeHtml(String(item.ok))} | ${escapeHtml(item.createdAt || '')}</div>`)
    .join('');
  const strategyItems = (out.recentStrategies || []).slice(0, 6)
    .filter((item) => match(`${item.strategy} ${item.evidence} ${item.goal}`))
    .map((item) => `<div class="ledger-item">${escapeHtml(item.success ? 'SUCCESS' : 'FAIL')} | ${escapeHtml(item.strategy)} | ${escapeHtml(String(item.evidence || '').slice(0, 100))}</div>`)
    .join('');
  const compactionItems = (out.compactions || []).slice(0, 5)
    .filter((item) => match(`${item.model} ${item.createdAt} ${JSON.stringify(item.summary || {})}`))
    .map((item) => `<div class="ledger-item">compaction | ${escapeHtml(item.model)} | pre=${Number(item.preTokens || 0)} post=${Number(item.postTokens || 0)} | ${escapeHtml(item.createdAt || '')}</div>`)
    .join('');
  q('missionTimelineTools').innerHTML = (filter === 'all' || filter === 'tools' || filter === 'strategies' || filter === 'compactions')
    ? `<strong>Tool and strategy trail</strong>${filter === 'all' || filter === 'tools' ? (toolItems || '') : ''}${filter === 'all' || filter === 'strategies' ? (strategyItems || '') : ''}${filter === 'all' || filter === 'compactions' ? (compactionItems || '') : ''}${toolItems || strategyItems || compactionItems ? '' : '<div class="ledger-item">No matching trail entries.</div>'}`
    : '';

  const artifactItems = (out.artifacts || []).slice(0, 8)
    .filter((item) => match(`${item.type} ${item.content} ${item.sourceRef || ''}`))
    .map((item, index) => `<button type="button" class="menu-btn" data-artifact-index="${index}" style="width:100%;margin:4px 0;text-align:left;">${escapeHtml(item.type)} | ${escapeHtml(String(item.content || '').slice(0, 90))}</button>`)
    .join('');
  q('missionTimelineArtifacts').innerHTML = (filter === 'all' || filter === 'artifacts')
    ? `<strong>Artifacts</strong>${artifactItems || '<div class="ledger-item">No matching artifacts.</div>'}`
    : '';
  q('missionTimelineArtifacts').querySelectorAll('[data-artifact-index]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = out.artifacts?.[Number(btn.dataset.artifactIndex)];
      if (!item) return;
      q('pcOutput').value = JSON.stringify(item, null, 2);
      showView('operator');
    });
  });
}

async function loadModelsForProvider(provider, currentModel = '') {
  try {
    const catalog = modelCatalog || await refreshModelCatalog();
    const out = catalog.providers.find((entry) => entry.provider === provider) || await jget(`/api/models?provider=${encodeURIComponent(provider)}`);
    const list = q('modelList');
    list.innerHTML = '';
    const models = out.models || [];
    for (const m of models) {
      const opt = document.createElement('option');
      const modelId = m.model_id || m.id || '';
      opt.value = modelId;
      const score = m.capability_score ?? m.score ?? '?';
      const ctx = m.context_window || m.contextWindow || '?';
      const rank = m.rank ? `#${m.rank}` : '#?';
      opt.textContent = `${rank} ${modelId} | score=${score} | ctx=${ctx}`;
      list.appendChild(opt);
    }
    const normalizedCurrentModel = stripProviderPrefix(currentModel, MODEL_PROVIDER_IDS);
    if (normalizedCurrentModel && models.some((m) => (m.model_id || m.id) === normalizedCurrentModel)) {
      list.value = normalizedCurrentModel;
    }
    q('modelCatalogStatus').textContent = `loaded ${models.length} ${provider} models`;
  } catch (error) {
    q('modelCatalogStatus').textContent = `load failed: ${String(error.message || error)}`;
  }
}

async function refreshRuntime() {
  const c = await jget('/api/config');
  runtimeConfigCache = c;
  setSelectByValueOrFirst('autonomyMode', c.runtime?.autonomyMode || 'autonomy-first');
  setSelectByValueOrFirst('shellEnabled', String(Boolean(c.runtime?.shellEnabled)));
  setSelectByValueOrFirst('maxIters', String(c.runtime?.maxToolIterations ?? 8));
  setSelectByValueOrFirst('fallbackEnabled', String(c.model?.routing?.fallbackEnabled !== false));
  fallbackSequence = (c.model?.routing?.fallbackProviders || [])
    .filter((provider) => provider && provider !== c.model?.provider)
    .map((provider) => ({
      provider,
      model: stripProviderPrefix(c.model?.providerModels?.[provider], MODEL_PROVIDER_IDS) || preferredModelForProvider(provider)
    }));
  renderFallbackSequence();
  q('runtimeStatus').textContent =
    `mode=${c.runtime?.autonomyMode || 'autonomy-first'} shell=${c.runtime?.shellEnabled} maxIters=${c.runtime?.maxToolIterations}`;
}

async function refreshProviderConfig() {
  const c = await jget('/api/providers/config');
  setSelectByValueOrFirst('ollamaUrl', c.ollamaBaseUrl || 'http://127.0.0.1:11434');
  setSelectByValueOrFirst('openrouterUrl', c.openrouterBaseUrl || 'https://openrouter.ai/api/v1');
  setSelectByValueOrFirst('nvidiaUrl', c.nvidiaBaseUrl || 'https://integrate.api.nvidia.com/v1');
  setSelectByValueOrFirst('xiaomimimoUrl', c.xiaomimimoBaseUrl || 'https://api.x.ai/v1');
  setSelectByValueOrFirst('genericUrl', c.openaiBaseUrl || c.genericBaseUrl || 'https://api.openai.com/v1');
  runtimeConfigCache = runtimeConfigCache || await jget('/api/config').catch(() => null);
  await refreshAuthCatalog();
}

async function refreshBrowserConfig() {
  const c = await jget('/api/browser/config');
  setSelectByValueOrFirst('cdpPreset', c.cdpUrl || 'http://127.0.0.1:9222');
  const st = await jget('/api/browser/status');
  q('browserStatusLine').textContent = st.ok ? 'connected' : `${st.error}${st.hint ? ' | ' + st.hint : ''}`;
  q('browserHealthValue').textContent = st.ok ? 'Connected' : 'Degraded';
  q('browserHealthMeta').textContent = st.error || st.hint || 'CDP reachable';
  q('browserCdpValue').textContent = c.cdpUrl || 'http://127.0.0.1:9222';
  q('browserTabMeta').textContent = Array.isArray(st.targets) ? `${st.targets.length} visible targets` : 'No live target list';
}

async function refreshTelegram() {
  const [cfg, st] = await Promise.all([jget('/api/telegram/config'), jget('/api/telegram/status')]);
  setSelectByValueOrFirst('telegramEnabled', String(Boolean(cfg.enabled)));
  q('tgStatus').textContent = `token=${cfg.hasToken ? 'set' : 'missing'} enabled=${cfg.enabled} running=${st.running}`;
}

async function refreshMission() {
  let allMissions = { missions: [], schedules: [] };
  try {
    allMissions = await jget('/api/missions');
  } catch (err) {
    console.error('refresh_missions_list_failed', err);
  }
  lastMissionList = Array.isArray(allMissions.missions) ? allMissions.missions : [];
  const picker = q('missionPicker');
  if (picker) {
    const selected = activeMissionId || picker.value || '';
    picker.innerHTML = '<option value="">Select mission...</option>' + lastMissionList
      .map((m) => {
        const id = String(m.id || '').trim();
        const label = `${id} | ${String(m.status || 'unknown')} | ${String(m.goal || '').slice(0, 80)}`;
        return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
      })
      .join('');
    if (selected && lastMissionList.some((m) => String(m.id || '') === selected)) {
      picker.value = selected;
    }
  }
  if (!activeMissionId && lastMissionList.length > 0) {
    activeMissionId = String(lastMissionList[0].id || '');
    localStorage.setItem('openunum_mission', activeMissionId);
  }

  // Refresh active mission
  if (activeMissionId) {
    try {
      const out = await jget(`/api/missions/status?id=${encodeURIComponent(activeMissionId)}`);
      if (out.error) {
        q('missionStatus').textContent = out.error;
      } else {
        const m = out.mission;
        q('missionStatus').textContent = `${m.status} step=${m.step}/${m.maxSteps}`;
        const latest = m.log?.[m.log.length - 1];
        if (latest) q('pcOutput').value = latest.reply;
        if (m.status !== 'running' && m.status !== 'stopping') {
          q('missionStatus').textContent = `${m.status} step=${m.step}/${m.maxSteps} (select another mission or start new)`;
        }
      }
    } catch {
      q('missionStatus').textContent = `mission_not_found: ${activeMissionId}`;
    }
  } else {
    q('missionStatus').textContent = 'idle';
  }
  await refreshMissionTimeline().catch(() => {});

  // Refresh scheduled missions
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

qa('.menu-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});
q('vaultEditCloseTop').onclick = closeVaultModal;
q('vaultEditClose').onclick = closeVaultModal;
q('vaultEditSave').onclick = () => saveVaultModal().catch((err) => {
  setStatus('providerStatus', `vault save failed: ${String(err.message || err)}`, { type: 'error', title: 'Vault' });
});
q('vaultEditTest').onclick = () => testVaultModal().catch((err) => {
  setStatus('providerStatus', `vault test failed: ${String(err.message || err)}`, { type: 'error', title: 'Vault' });
});
q('vaultEditModal').addEventListener('cancel', (event) => {
  event.preventDefault();
  closeVaultModal();
});

q('newChat').onclick = async () => {
  await resetSession();
  await refreshContextStatus();
};
q('newChatInMenu').onclick = async () => {
  await resetSession();
  await refreshContextStatus();
};
q('deleteAllSessions').onclick = async () => {
  const confirmed = confirm('Delete all sessions? This action cannot be undone.');
  if (!confirmed) return;
  await jrequest('POST', '/api/sessions/clear', { force: true, keepSessionId: '' });
  await resetSession();
  await refreshContextStatus();
  await refreshTacticalLedger();
};
q('exportSessionBtn').onclick = async () => {
  const out = await jget(`/api/sessions/${encodeURIComponent(sessionId)}/export`);
  q('pcOutput').value = JSON.stringify(out, null, 2);
  showView('operator');
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `openunum-session-${sessionId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  setStatus(
    'runtimeStatus',
    `session export ready | messages=${Number(out.messages?.length || 0)} tokens=${Number(out.estimatedTokens || 0)}`,
    { type: 'success', title: 'Session Export' }
  );
  await refreshTacticalLedger();
};
q('importSessionBtn').onclick = () => q('importSessionFile').click();
q('importSessionFile').onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const parsed = JSON.parse(text);
  const importedSessionId = String(parsed.sessionId || crypto.randomUUID());
  const out = await jpost('/api/sessions/import', {
    sessionId: importedSessionId,
    messages: Array.isArray(parsed.messages) ? parsed.messages : []
  });
  sessionId = out.session.sessionId;
  localStorage.setItem('openunum_session', sessionId);
  q('chatMeta').textContent = sessionId;
  await loadSession();
  await refreshSessionList();
  await refreshContextStatus();
  await refreshTacticalLedger();
  setStatus(
    'runtimeStatus',
    `session imported | ${sessionId} | messages=${Number(out.session.messageCount || 0)}`,
    { type: 'success', title: 'Session Import' }
  );
  showView('chat');
  q('importSessionFile').value = '';
};
qa('.quick-prompt').forEach((btn) => {
  btn.addEventListener('click', () => {
    q('message').value = btn.dataset.prompt || '';
    q('message').focus();
  });
});
q('autoEscalateToggle').onclick = () => {
  autoEscalateEnabled = !autoEscalateEnabled;
  localStorage.setItem('openunum_auto_escalate', String(autoEscalateEnabled));
  q('autoEscalateToggle').textContent = `Auto: ${autoEscalateEnabled ? 'On' : 'Off'}`;
};
q('liveActivityToggle').onclick = () => {
  liveActivityEnabled = !liveActivityEnabled;
  localStorage.setItem('openunum_live_activity', String(liveActivityEnabled));
  q('liveActivityToggle').textContent = `Live: ${liveActivityEnabled ? 'On' : 'Off'}`;
};

q('provider').onchange = async () => {
  await loadModelsForProvider(q('provider').value);
};

q('loadModels').onclick = async () => {
  await loadModelsForProvider(q('provider').value);
};

q('switchModel').onclick = async () => {
  const model = q('modelList').value;
  if (!model) return;
  const out = await jpost('/api/model/switch', { provider: q('provider').value, model });
  topStatus.textContent = `cfg=${formatProviderModel(out.provider, out.model)} active=${formatProviderModel(out.activeProvider, out.activeModel)}`;
  setStatus('modelCatalogStatus', `model switched to ${formatProviderModel(out.provider, out.model)}`, {
    type: 'success',
    title: 'Model Routing'
  });
  await refreshModelCatalog();
  await refreshRuntimeOverview();
};

q('saveRouting').onclick = async () => {
  const enabled = q('fallbackEnabled').value === 'true';
  const provider = q('provider').value;
  const selectedModel = q('modelList').value;
  ensureFallbackSequence(provider);
  
  // Filter offline models from fallback sequence
  const onlineFallbackSequence = fallbackSequence.filter(entry => {
    const p = modelCatalog.providers.find(cp => cp.provider === entry.provider);
    if (!p) return true;
    const m = p.models.find(cm => cm.model_id === entry.model);
    return m && m.status !== 'offline' && m.status !== 'quarantined';
  });

  const providerModels = {
    [provider]: `${provider}/${selectedModel}`
  };
  for (const entry of onlineFallbackSequence) {
    if (entry.provider && entry.model) providerModels[entry.provider] = `${entry.provider}/${entry.model}`;
  }
  const out = await jpost('/api/config', {
    model: {
      provider,
      ...(selectedModel ? { model: selectedModel } : {}),
      providerModels,
      routing: {
        fallbackEnabled: enabled,
        fallbackProviders: onlineFallbackSequence.map((entry) => entry.provider)
      }
    },
    runtime: {
      shellEnabled: q('shellEnabled').value === 'true',
      maxToolIterations: Number(q('maxIters').value || 8)
    }
  });
  setStatus(
    'modelCatalogStatus',
    `routing saved | primary=${formatProviderModel(provider, selectedModel || '')} | fallbacks=${onlineFallbackSequence.map((entry) => entry.provider).join(' -> ') || 'none'}`,
    { type: 'success', title: 'Model Routing' }
  );
  await refreshModel();
  await refreshRuntimeOverview();
  await runWebuiWireValidation('routing_save');
};

q('prefillLocalAuth').onclick = async () => {
  const out = await jpost('/api/auth/prefill-local', { overwriteBaseUrls: false });
  setStatus(
    'providerStatus',
    `local auth scan saved | files=${Number(out.scannedFiles?.length || 0)} | github=${Boolean(out.imported?.githubToken)}`,
    { type: 'success', title: 'Provider Vault' }
  );
  await refreshProviderConfig();
  await refreshModelCatalog();
  await refreshRuntimeOverview();
  await runWebuiWireValidation('prefill_local_auth');
};

q('refreshAuthCatalog').onclick = async () => {
  await refreshProviderConfig();
  await refreshModelCatalog();
  await refreshRuntimeOverview();
  await runWebuiWireValidation('refresh_auth_catalog');
};

q('showAllProviderRows').onclick = () => {
  hiddenProviderRows = [];
  normalizeHiddenRows();
  refreshAddRowSelectors();
  renderProviderMatrix(authCatalog?.providers || []);
};

q('showAllServiceRows').onclick = () => {
  hiddenServiceRows = [];
  normalizeHiddenRows();
  refreshAddRowSelectors();
  renderAuthMethodTable(authCatalog?.auth_methods || []);
};

q('addProviderRow').onclick = () => {
  const id = q('providerAddSelect').value;
  if (!id) {
    setStatus('providerStatus', 'no hidden/disabled provider rows to add', { type: 'warn', title: 'Provider Vault' });
    return;
  }
  hiddenProviderRows = hiddenProviderRows.filter((row) => row !== id);
  normalizeHiddenRows();
  refreshAddRowSelectors();
  renderProviderMatrix(authCatalog?.providers || []);
  setStatus('providerStatus', `added provider row ${id}`, { type: 'success', title: 'Provider Vault' });
  runWebuiWireValidation(`provider_add_row:${id}`).catch(() => {});
};

q('addServiceRow').onclick = () => {
  const id = q('serviceAddSelect').value;
  if (!id) {
    setStatus('providerStatus', 'no hidden service rows to add', { type: 'warn', title: 'Provider Vault' });
    return;
  }
  hiddenServiceRows = hiddenServiceRows.filter((row) => row !== id);
  normalizeHiddenRows();
  refreshAddRowSelectors();
  renderAuthMethodTable(authCatalog?.auth_methods || []);
  setStatus('providerStatus', `added service row ${id}`, { type: 'success', title: 'Provider Vault' });
  runWebuiWireValidation(`service_add_row:${id}`).catch(() => {});
};

q('addFallbackRow').onclick = () => {
  const provider = q('fallbackProviderPicker').value;
  if (!provider || provider === q('provider').value || fallbackSequence.some((entry) => entry.provider === provider)) return;
  fallbackSequence.push({ provider, model: preferredModelForProvider(provider) });
  q('fallbackProviderPicker').value = '';
  renderFallbackSequence();
};

q('autoFillFallbacks').onclick = () => {
  const primary = q('provider').value;
  fallbackSequence = MODEL_PROVIDER_IDS
    .filter((provider) => provider !== primary)
    .map((provider) => ({ provider, model: preferredModelForProvider(provider) }));
  renderFallbackSequence();
};

q('saveRuntime').onclick = async () => {
  const out = await jpost('/api/config', {
    runtime: {
      autonomyMode: q('autonomyMode').value,
      shellEnabled: q('shellEnabled').value === 'true',
      maxToolIterations: Number(q('maxIters').value || 8)
    },
    model: {
      routing: {
        fallbackEnabled: q('fallbackEnabled').value === 'true',
        fallbackProviders: fallbackSequence.map((entry) => entry.provider)
      }
    }
  });
  setStatus(
    'runtimeStatus',
    `saved mode=${out.runtime.autonomyMode || q('autonomyMode').value} shell=${out.runtime.shellEnabled} maxIters=${out.runtime.maxToolIterations}`,
    { type: 'success', title: 'Runtime' }
  );
  await refreshRuntimeOverview();
  await runWebuiWireValidation('runtime_save');
};

q('compactContextBtn').onclick = async () => {
  const out = await jpost('/api/context/compact', { sessionId, dryRun: false });
  setStatus(
    'runtimeStatus',
    out.skipped
      ? `compact skipped: ${out.reason}`
      : `compacted pre=${Number(out.preTokens || 0)} post=${Number(out.postTokens || 0)} artifacts=${Number(out.artifactsCount || 0)}`,
    { type: out.skipped ? 'warn' : 'success', title: 'Context' }
  );
  await refreshContextStatus();
  await loadSession();
  await refreshSessionList();
  await refreshTacticalLedger();
};
q('refreshLedgerBtn').onclick = refreshTacticalLedger;
q('refreshPhase0Diag').onclick = refreshPhase0Diagnostics;

q('applyAutonomyMode').onclick = async () => {
  const out = await jpost('/api/autonomy/mode', { mode: q('autonomyMode').value });
  setStatus(
    'runtimeStatus',
    `applied mode=${out.mode} shell=${out.runtime?.shellEnabled} maxIters=${out.runtime?.maxToolIterations}`,
    { type: 'success', title: 'Runtime' }
  );
  await refreshRuntime();
  await refreshModel();
  await refreshRuntimeOverview();
};

q('saveCdp').onclick = async () => {
  const out = await jpost('/api/browser/config', { cdpUrl: q('cdpPreset').value });
  setStatus('browserStatusLine', `saved ${out.cdpUrl}`, { type: 'success', title: 'Browser CDP' });
  await refreshBrowserConfig();
  await refreshRuntimeOverview();
};

q('launchBrowser').onclick = async () => {
  const out = await jpost('/api/browser/launch', {});
  setStatus('browserStatusLine', out.ok ? `launched pid=${out.pid} at ${out.cdpUrl}` : 'launch failed', {
    type: out.ok ? 'success' : 'error',
    title: 'Browser'
  });
  if (out.cdpUrl) setSelectByValueOrFirst('cdpPreset', out.cdpUrl);
  await refreshBrowserConfig();
  await refreshRuntimeOverview();
};

q('navBtn').onclick = async () => {
  const out = await jpost('/api/browser/navigate', { url: q('navUrl').value.trim() });
  q('pcOutput').value = JSON.stringify(out, null, 2);
  showView('operator');
};

q('searchBtn').onclick = async () => {
  const out = await jpost('/api/browser/search', { query: q('searchQ').value.trim() });
  q('pcOutput').value = JSON.stringify(out, null, 2);
  showView('operator');
};

q('extractBtn').onclick = async () => {
  const out = await jpost('/api/browser/extract', { selector: 'body' });
  q('pcOutput').value = out?.text || JSON.stringify(out, null, 2);
  showView('operator');
};

q('saveToken').onclick = async () => {
  await jpost('/api/telegram/config', {
    botToken: q('tgToken').value.trim(),
    enabled: q('telegramEnabled').value === 'true'
  });
  await refreshTelegram();
};

q('startTg').onclick = async () => {
  await jpost('/api/telegram/start');
  await refreshTelegram();
};

q('stopTg').onclick = async () => {
  await jpost('/api/telegram/stop');
  await refreshTelegram();
};

q('tgRefresh').onclick = refreshTelegram;

q('runShell').onclick = async () => {
  const out = await jpost('/api/tool/run', { name: 'shell_run', args: { cmd: q('shellCmd').value } });
  q('pcOutput').value = JSON.stringify(out.result, null, 2);
};

q('openTargetBtn').onclick = async () => {
  const out = await jpost('/api/tool/run', { name: 'desktop_open', args: { target: q('openTarget').value } });
  q('pcOutput').value = JSON.stringify(out.result, null, 2);
};

q('runXdotool').onclick = async () => {
  const out = await jpost('/api/tool/run', { name: 'desktop_xdotool', args: { cmd: q('xdotoolCmd').value } });
  q('pcOutput').value = JSON.stringify(out.result, null, 2);
};

q('startMission').onclick = async () => {
  const goal = q('missionGoal').value.trim();
  if (!goal) return;
  const out = await jpost('/api/missions/start', {
    goal,
    maxSteps: Number(q('missionSteps').value || 6),
    intervalMs: Number(q('missionInterval').value || 400)
  });
  activeMissionId = out.id;
  localStorage.setItem('openunum_mission', activeMissionId);
  setStatus('missionStatus', `running id=${activeMissionId}`, { type: 'success', title: 'Mission' });
  await refreshMission();
  await refreshMissionTimeline();
  await runWebuiWireValidation('mission_start');
};

q('stopMission').onclick = async () => {
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
  activeMissionId = picked;
  localStorage.setItem('openunum_mission', activeMissionId);
  await refreshMission();
  await refreshMissionTimeline();
};
q('clearMissionSelectionBtn').onclick = async () => {
  activeMissionId = '';
  localStorage.removeItem('openunum_mission');
  if (q('missionPicker')) q('missionPicker').value = '';
  await refreshMission();
  await refreshMissionTimeline();
};
q('missionPicker').onchange = async () => {
  const picked = String(q('missionPicker')?.value || '').trim();
  if (!picked) return;
  activeMissionId = picked;
  localStorage.setItem('openunum_mission', activeMissionId);
  await refreshMission();
  await refreshMissionTimeline();
};
q('openMissionSessionBtn').onclick = async () => {
  if (!missionTimelineCache?.mission?.sessionId) return;
  sessionId = missionTimelineCache.mission.sessionId;
  localStorage.setItem('openunum_session', sessionId);
  q('chatMeta').textContent = sessionId;
  await loadSession();
  await refreshSessionList();
  await refreshContextStatus();
  await refreshTacticalLedger();
  showView('chat');
};
q('cloneMissionSessionBtn').onclick = async () => {
  const sourceSessionId = missionTimelineCache?.mission?.sessionId;
  if (!sourceSessionId) return;
  const targetSessionId = crypto.randomUUID();
  const out = await jpost('/api/sessions/clone', { sourceSessionId, targetSessionId });
  sessionId = out.session.sessionId;
  localStorage.setItem('openunum_session', sessionId);
  q('chatMeta').textContent = sessionId;
  await loadSession();
  await refreshSessionList();
  await refreshContextStatus();
  await refreshTacticalLedger();
  setStatus('runtimeStatus', `mission session cloned | ${sourceSessionId} -> ${sessionId}`, {
    type: 'success',
    title: 'Mission'
  });
  showView('chat');
};
q('missionTimelineFilter').onchange = () => renderMissionTimeline();
q('missionTimelineSearch').oninput = () => renderMissionTimeline();

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

q('cpSelfHealDry').onclick = () => runControlPlaneRequest('POST', '/api/self-heal', { dryRun: true });
q('cpSelfHealFix').onclick = () => runControlPlaneRequest('POST', '/api/self-heal/fix', {});
q('cpSelfHealStatus').onclick = () => runControlPlaneRequest('GET', '/api/selfheal/status');

q('cpMasterStatus').onclick = () => runControlPlaneRequest('GET', '/api/autonomy/master/status');
q('cpMasterStart').onclick = () => runControlPlaneRequest('POST', '/api/autonomy/master/start', {});
q('cpMasterStop').onclick = () => runControlPlaneRequest('POST', '/api/autonomy/master/stop', {});
q('cpMasterCycle').onclick = () => runControlPlaneRequest('POST', '/api/autonomy/master/cycle', {});
q('cpMasterImprove').onclick = () => runControlPlaneRequest('POST', '/api/autonomy/master/self-improve', {});
q('cpMasterLearnSkills').onclick = () => runControlPlaneRequest('POST', '/api/autonomy/master/learn-skills', {});
q('cpMasterSelfTest').onclick = () => runControlPlaneRequest('POST', '/api/autonomy/master/self-test', {});

q('cpResearchRun').onclick = () => runControlPlaneRequest('POST', '/api/research/run', { simulate: false });
q('cpResearchRecent').onclick = () => runControlPlaneRequest('GET', '/api/research/recent?limit=25');
q('cpResearchQueue').onclick = () => runControlPlaneRequest('GET', '/api/research/queue?limit=50');
q('cpResearchApprove').onclick = () =>
  runControlPlaneRequest('POST', '/api/research/approve', {
    url: q('cpResearchUrl').value.trim(),
    note: q('cpResearchNote').value.trim()
  });

q('cpWorkersList').onclick = () => runControlPlaneRequest('GET', '/api/autonomy/workers?limit=50');
q('cpWorkerStatus').onclick = () => {
  const id = q('cpWorkerId').value.trim();
  if (!id) return;
  runControlPlaneRequest('GET', `/api/autonomy/workers/status?id=${encodeURIComponent(id)}`);
};
q('cpSelfEditRuns').onclick = () => runControlPlaneRequest('GET', '/api/autonomy/self-edit?limit=25');
q('cpSelfEditStatus').onclick = () => {
  const id = q('cpSelfEditId').value.trim();
  if (!id) return;
  runControlPlaneRequest('GET', `/api/autonomy/self-edit/status?id=${encodeURIComponent(id)}`);
};
q('cpModelScoutRun').onclick = () =>
  runControlPlaneRequest('POST', '/api/autonomy/model-scout/run', {
    query: q('cpModelScoutQuery').value.trim(),
    monitorLocal: true
  });
q('cpModelScoutList').onclick = () => runControlPlaneRequest('GET', '/api/autonomy/model-scout?limit=20');
q('cpModelScoutStatus').onclick = () => {
  const id = q('cpModelScoutId').value.trim();
  if (!id) return;
  runControlPlaneRequest('GET', `/api/autonomy/model-scout/status?id=${encodeURIComponent(id)}`);
};
q('cpTaskRun').onclick = () =>
  runControlPlaneRequest('POST', '/api/autonomy/tasks/run', {
    goal: q('cpTaskGoal').value.trim(),
    plan: [
      'Inspect current runtime state',
      'Verify the service surface',
      'Record monitoring evidence'
    ],
    steps: [
      {
        kind: 'tool',
        label: 'inspect host',
        tool: 'shell_run',
        args: { cmd: 'uname -a' }
      },
      {
        kind: 'tool',
        label: 'verify health',
        tool: 'http_request',
        args: { url: `${location.origin}/api/health`, method: 'GET' }
      }
    ],
    verify: [
      { kind: 'step_ok', stepIndex: 0 },
      { kind: 'http', url: `${location.origin}/api/health`, expectStatus: 200 }
    ],
    monitor: [
      { kind: 'http', url: `${location.origin}/api/runtime/inventory`, expectStatus: 200 }
    ]
  });
q('cpTaskList').onclick = () => runControlPlaneRequest('GET', '/api/autonomy/tasks?limit=20');
q('cpTaskStatus').onclick = () => {
  const id = q('cpTaskId').value.trim();
  if (!id) return;
  runControlPlaneRequest('GET', `/api/autonomy/tasks/status?id=${encodeURIComponent(id)}`);
};

q('cpOpsRecent').onclick = () => runControlPlaneRequest('GET', '/api/operations/recent?limit=50');
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
  let body;
  const raw = q('cpBody').value.trim();
  if (method !== 'GET' && raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      q('cpStatus').textContent = 'invalid JSON body';
      return;
    }
  }
  await runControlPlaneRequest(method, path, body);
};

q('send').onclick = async () => {
  if (isCurrentSessionPending()) return;
  const message = q('message').value.trim();
  if (!message) return;
  if (!isStatusCheckMessage(message) && !/^\/\w+/.test(message)) {
    lastTaskPrompt = message;
    localStorage.setItem('openunum_last_task_prompt', lastTaskPrompt);
  }
  const requestSessionId = sessionId;
  const requestToken = ++requestTokenSeq;
  pendingSessions.add(requestSessionId);
  updateComposerPendingState();
  q('message').value = '';
  pushMsg('user', message);
  const typing = appendTypingBubble();
  const startedAtIso = new Date().toISOString();
  typing.persistScope = `pending:${requestSessionId}:${startedAtIso}`;
  try {
    if (/^\/auto\b/i.test(message)) {
      await runAutoMissionFromChat(message, typing);
      return;
    }
    const out = await jpost('/api/chat', { sessionId: requestSessionId, message }, { timeoutMs: 70000 });
    if (out?.pending) {
      await resolvePendingReply(typing, out.startedAt || startedAtIso, requestSessionId, requestToken);
      return;
    }
    if (shouldEscalateToAuto(message, out, autoEscalateEnabled)) {
      typing.bubble.textContent = 'Planning detected. Auto mission engaged...';
      await runAutoMissionFromChat(`/auto ${message}`, typing);
      return;
    }
    if (isStatusCheckMessage(message) && isPlanningReply(out) && lastTaskPrompt) {
      typing.bubble.textContent = 'Status check detected while planning continues. Resuming autonomous mission...';
      await runAutoMissionFromChat(`/auto ${lastTaskPrompt}`, typing);
      return;
    }
    const traceHtml = renderTrace(out?.trace);
    const assistantHtml = `${out?.replyHtml || out?.reply || '(no reply)'}${traceHtml}`;
    typing.bubble.innerHTML = assistantHtml;
    void typing.bubble.offsetHeight; // force reflow so markdown/code blocks recalculate layout
    if (out?.model?.provider && out?.model?.model && out?.model?.activeProvider && out?.model?.activeModel) {
      topStatus.textContent = `cfg=${formatProviderModel(out.model.provider, out.model.model)} active=${formatProviderModel(out.model.activeProvider, out.model.activeModel)}`;
    }
    await refreshSessionList();
    await refreshTacticalLedger();
  } catch (error) {
    const msg = String(error.message || error);
    if (msg.includes('request_timeout')) {
      typing.bubble.textContent = 'Request is still running. Switching to live pending view...';
      await resolvePendingReply(typing, startedAtIso, requestSessionId, requestToken);
    } else {
      typing.bubble.textContent = `request failed: ${msg}`;
    }
  } finally {
    pendingSessions.delete(requestSessionId);
    updateComposerPendingState();
  }
};

q('message').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    q('send').click();
  }
});

setInterval(() => {
  refreshMission().catch(() => {});
}, 3000);

(async () => {
  try {
    showView('chat');
    if (q('cpPath')) q('cpPath').value = '/api/health';
    if (q('cpBody')) q('cpBody').value = '{\n  "dryRun": true\n}';
    
    const initSteps = [
      { name: 'session', fn: () => ensureSessionExists(sessionId) },
      { name: 'capabilities', fn: refreshCapabilities },
      { name: 'model', fn: refreshModel },
      { name: 'runtime', fn: refreshRuntime },
      { name: 'providers', fn: refreshProviderConfig },
      //{ name: 'browser', fn: refreshBrowserConfig }, // Temporarily disabled due to CDP endpoint issues
      { name: 'overview', fn: refreshRuntimeOverview },
      { name: 'phase0-diag', fn: refreshPhase0Diagnostics },
      { name: 'telegram', fn: refreshTelegram },
      { name: 'sessions', fn: refreshSessionList },
      { name: 'load', fn: loadSession },
      { name: 'mission', fn: refreshMission },
      { name: 'context', fn: refreshContextStatus },
      //{ name: 'ledger', fn: refreshTacticalLedger }, // Temporarily disabled to speed up initialization
      { name: 'timeline', fn: refreshMissionTimeline }
    ];

    for (const step of initSteps) {
      try {
        console.log(`Starting init step: ${step.name}`);
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout after 5 seconds`)), 5000);
        });
        await Promise.race([step.fn(), timeoutPromise]);
        console.log(`Completed init step: ${step.name}`);
      } catch (e) {
        console.warn(`Init step failed: ${step.name}`, e);
        topStatus.textContent = `init step failed: ${step.name} (${String(e.message || e)})`;
      }
    }
    
    if (topStatus.textContent === 'booting...') {
      topStatus.textContent = 'ready';
    } else if (topStatus.textContent.includes('init failed')) {
      topStatus.textContent += ' (but continuing with limited functionality)';
    }
  } catch (error) {
    const msg = String(error?.message || error);
    console.error('openunum_ui_init_failed', error);
    topStatus.textContent = `init failed: ${msg}`;
    const providerStatus = q('providerStatus');
    if (providerStatus) providerStatus.textContent = `ui init failed: ${msg}`;
  }
})();
