import { q, qa } from './dom.js';

export function showView(viewId, viewMeta = {}) {
  qa('.menu-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === viewId));
  qa('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${viewId}`));
  const [title, subtitle] = viewMeta[viewId] || ['OpenUnum', ''];
  q('viewTitle').textContent = title;
  q('viewSubtitle').textContent = subtitle;
}

