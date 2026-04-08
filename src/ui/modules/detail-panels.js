export function loadDetailPanelState(storage, storageKey = 'openunum_detail_panels') {
  try {
    const raw = storage?.getItem?.(storageKey) || '{}';
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

export function detailPanelKey(scope, name, fallbackScope = 'global') {
  return `${scope || fallbackScope}:${name}`;
}

export function rememberDetailPanelState(state, key, patch, storage, storageKey = 'openunum_detail_panels') {
  state[key] = { ...(state[key] || {}), ...patch };
  storage?.setItem?.(storageKey, JSON.stringify(state));
}

export function bindPersistentDetailPanels(root, state, rememberFn) {
  if (!root) return;
  root.querySelectorAll('details[data-persist-key]').forEach((details) => {
    const key = details.dataset.persistKey;
    if (!key) return;
    const saved = state[key] || {};
    if (typeof saved.open === 'boolean') details.open = saved.open;
    const body = details.querySelector('.trace-body');
    if (body && Number.isFinite(saved.scrollTop)) {
      body.scrollTop = saved.scrollTop;
    }
    details.addEventListener('toggle', () => {
      rememberFn(key, { open: details.open });
    });
    if (body) {
      body.addEventListener('scroll', () => {
        rememberFn(key, { scrollTop: body.scrollTop });
      }, { passive: true });
    }
  });
}
