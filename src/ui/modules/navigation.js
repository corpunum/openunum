import { q, qa } from './dom.js';

export const VIEW_META = {
  chat: ['Chat Terminal', 'Autonomous agent conversation'],
  operator: ['Execution Trace', 'Runtime, tools, and live execution state'],
  'model-routing': ['Model Routing', 'Primary model selection and fallback strategy'],
  'provider-config': ['Provider Vault', 'Provider matrix, models, and secure auth vault'],
  'settings-tooling': ['Tooling and Skills', 'Agent tools, skills inventory, and model-backed rollout'],
  browser: ['Browser Ops', 'Browser and hardware control'],
  telegram: ['Telegram Bridge', 'Channel connectivity and polling control'],
  missions: ['Mission Runner', 'Autonomous execution loops'],
  'control-plane': ['Control Plane API', 'Backend operations and full API access']
};

const CATEGORY_MAP = {
  'general': 'General',
  'model-routing': 'Model Routing',
  'provider-vault': 'Providers & Vault',
  'runtime': 'Runtime & Autonomy',
  'tooling': 'Tools & Skills',
  'browser': 'Browser / CDP',
  'channels': 'Channels',
  'developer': 'Developer'
};

export function showView(viewId, viewMeta = {}) {
  qa('.menu-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === viewId));
  qa('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${viewId}`));
  const [title, subtitle] = viewMeta[viewId] || ['OpenUnum', ''];
  q('viewTitle').textContent = title;
  q('viewSubtitle').textContent = subtitle;
}

export function initSettingsHub() {
  const hub = q('settingsHub');
  if (!hub) return;

  const gearBtn = q('settingsGearBtn');
  const closeBtn = q('settingsHubClose');
  const railItems = qa('.settings-rail-item');
  const categories = qa('.settings-category');
  const contentTitle = q('settingsContentTitle');

  if (gearBtn) {
    gearBtn.addEventListener('click', () => {
      hub.showModal();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      hub.close();
    });
  }

  hub.addEventListener('cancel', (event) => {
    event.preventDefault();
    hub.close();
  });

  railItems.forEach((item) => {
    item.addEventListener('click', async () => {
      const category = item.dataset.category;
      railItems.forEach((i) => i.classList.toggle('active', i.dataset.category === category));
      categories.forEach((c) => c.classList.toggle('active', c.id === `settings-${category}`));
      if (contentTitle) {
        contentTitle.textContent = CATEGORY_MAP[category] || category;
      }
      // Trigger deferred data loading for this category
      if (window.__openunum_runDeferredStepsForCategory) {
        window.__openunum_runDeferredStepsForCategory(category);
      }
    });
  });

  // General category buttons that link to views
  const openTraceViewBtn = q('openTraceView');
  if (openTraceViewBtn) {
    openTraceViewBtn.addEventListener('click', () => {
      hub.close();
      showView('operator');
    });
  }
  const openMissionViewBtn = q('openMissionView');
  if (openMissionViewBtn) {
    openMissionViewBtn.addEventListener('click', () => {
      hub.close();
      showView('missions');
    });
  }
}

export function initSidebar() {
  const layout = q('layoutRoot');
  const toggle = q('sidebarToggle');
  const collapse = q('sidebarCollapse');
  const sidebar = q('sidebarMenu');

  if (!layout || !sidebar) return;

  const saved = localStorage.getItem('openunum_sidebar_collapsed');
  if (saved === 'true') {
    layout.classList.add('sidebar-collapsed');
    if (toggle) toggle.classList.add('visible');
  }

  if (collapse) {
    collapse.addEventListener('click', () => {
      layout.classList.add('sidebar-collapsed');
      if (toggle) toggle.classList.add('visible');
      localStorage.setItem('openunum_sidebar_collapsed', 'true');
    });
  }

  if (toggle) {
    toggle.addEventListener('click', () => {
      layout.classList.remove('sidebar-collapsed');
      toggle.classList.remove('visible');
      localStorage.removeItem('openunum_sidebar_collapsed');
    });
  }
}

// Map old view names to settings hub categories
const VIEW_TO_CATEGORY = {
  'model-routing': 'model-routing',
  'provider-config': 'provider-vault',
  'settings-tooling': 'tooling',
  browser: 'browser',
  telegram: 'channels',
  operator: 'runtime',
  'control-plane': 'developer',
  missions: 'developer'
};

export function openSettingsCategory(category) {
  const hub = q('settingsHub');
  if (!hub) return;

  const railItems = qa('.settings-rail-item');
  const categories = qa('.settings-category');
  const contentTitle = q('settingsContentTitle');

  railItems.forEach((i) => i.classList.toggle('active', i.dataset.category === category));
  categories.forEach((c) => c.classList.toggle('active', c.id === `settings-${category}`));
  if (contentTitle) {
    contentTitle.textContent = CATEGORY_MAP[category] || category;
  }
  hub.showModal();

  // Trigger deferred loading
  if (window.__openunum_runDeferredStepsForCategory) {
    window.__openunum_runDeferredStepsForCategory(category);
  }
}

// Override showView to redirect old view names to settings hub
export function createShowView(originalShowView) {
  return function showViewRedirect(viewId, viewMeta) {
    const category = VIEW_TO_CATEGORY[viewId];
    if (category) {
      openSettingsCategory(category);
      return;
    }
    originalShowView(viewId, viewMeta);
  };
}
