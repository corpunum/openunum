import { q, escapeHtml } from './dom.js';

let toastCounter = 0;

export function showToast(message, type = 'info', title = 'Action') {
  const host = q('toastStack');
  if (!host) return;
  const id = `toast-${Date.now()}-${toastCounter++}`;
  const level = type === 'error' ? 'bad' : type === 'warn' ? 'warn' : type === 'success' ? 'good' : '';
  const node = document.createElement('div');
  node.className = `toast ${level}`;
  node.id = id;
  node.innerHTML = `
    <div class="toast-head">
      <span>${escapeHtml(title)}</span>
      <span id="${id}-state">auto-close 5s</span>
    </div>
    <div class="toast-body">${escapeHtml(String(message || ''))}</div>
    <div class="toast-actions">
      <button type="button" id="${id}-pin">Pin</button>
      <button type="button" id="${id}-dismiss">Dismiss</button>
    </div>
    <div class="toast-progress"><div></div></div>
  `;
  host.prepend(node);
  let pinned = false;
  const stateEl = q(`${id}-state`);
  let timerId = null;
  const cleanup = () => {
    if (node?.parentNode) node.parentNode.removeChild(node);
  };
  const armAutoClose = () => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      if (!pinned) cleanup();
    }, 5000);
  };
  armAutoClose();
  q(`${id}-pin`)?.addEventListener('click', () => {
    pinned = !pinned;
    node.classList.toggle('pinned', pinned);
    if (stateEl) stateEl.textContent = pinned ? 'pinned' : 'auto-close 5s';
    if (!pinned) armAutoClose();
  });
  q(`${id}-dismiss`)?.addEventListener('click', () => {
    if (timerId) clearTimeout(timerId);
    cleanup();
  });
  while (host.children.length > 5) host.removeChild(host.lastChild);
}

export function setStatus(id, message, { toast = true, type = 'info', title = 'Action' } = {}) {
  const el = q(id);
  if (el) el.textContent = String(message || '');
  if (toast) showToast(message, type, title);
}

