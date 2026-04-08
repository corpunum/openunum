export function sortSessionsByRecency(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => {
      const at = Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt || 0) || 0;
      const bt = Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt || 0) || 0;
      return bt - at;
    });
}

export function filterSessionsByQuery(rows = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((s) => {
    const haystack = `${s.title || ''} ${s.preview || ''} ${s.sessionId || ''}`.toLowerCase();
    return haystack.includes(q);
  });
}

export function renderSessionListView({
  sessionListEl,
  sessionCache = [],
  query = '',
  sessionId = '',
  escapeHtml,
  formatRelativeTime,
  onSwitch,
  onDelete
}) {
  if (!sessionListEl) return;
  sessionListEl.innerHTML = '';
  const filteredSessions = filterSessionsByQuery(sessionCache, query);
  if (!filteredSessions.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = String(query || '').trim() ? 'No matching sessions' : 'No sessions yet';
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
    btn.onclick = async () => onSwitch?.(s.sessionId);
    itemWrap.appendChild(btn);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'session-delete';
    del.title = 'Delete session';
    del.textContent = 'X';
    del.onclick = async (event) => onDelete?.(event, s);

    row.appendChild(itemWrap);
    row.appendChild(del);
    sessionListEl.appendChild(row);
  }
}
