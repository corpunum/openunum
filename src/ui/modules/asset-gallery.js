export function createAssetGalleryController({ jget, escapeHtml }) {
  let galleryCache = null;

  async function refreshGallery() {
    try {
      const out = await jget('/api/assets/list');
      galleryCache = out.assets || [];
      renderGallery();
    } catch { /* gallery is non-critical */ }
  }

  function renderGallery() {
    const container = document.getElementById('galleryPanel');
    if (!container) return;
    if (!Array.isArray(galleryCache) || galleryCache.length === 0) {
      container.innerHTML = '<div class="hint" style="padding:8px;color:var(--muted)">No generated images yet.</div>';
      return;
    }
    container.innerHTML = galleryCache.map((asset) => {
      const url = `/api/assets/${encodeURIComponent(asset.filename)}`;
      const date = asset.createdAt ? asset.createdAt.slice(0, 10) : '';
      return `<div class="gallery-item">
        <a href="${url}" target="_blank" rel="noopener noreferrer">
          <img src="${url}" alt="${escapeHtml(asset.filename)}" class="gallery-thumbnail" loading="lazy" onload="this.style.backgroundImage='none'" />
        </a>
        <div class="gallery-item-meta">
          <span class="gallery-item-date">${escapeHtml(date)}</span>
          <a href="${url}" download="${escapeHtml(asset.filename)}" class="gallery-download" title="Download"><img src="/ui/icons/unum_downloading.gif" alt="" class="dl-icon" /></a>
        </div>
      </div>`;
    }).join('');
  }

  return { refreshGallery, renderGallery };
}