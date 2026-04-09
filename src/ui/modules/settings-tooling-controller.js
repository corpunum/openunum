function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function badge(text, level = '') {
  const cls = level ? `badge ${level}` : 'badge';
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

export function createSettingsToolingController({
  q,
  jget,
  jpost,
  setStatus,
  runWebuiWireValidation,
  refreshRuntime
}) {
  let inventory = null;

  function renderTools(rows = []) {
    const body = q('toolingToolsBody');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="hint">No tools available.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((row) => {
      const mbt = row?.model_backed || {};
      const typeBadge = mbt.contract
        ? badge(mbt.enabled ? 'model-backed enabled' : 'model-backed disabled', mbt.enabled ? 'good' : 'warn')
        : badge('native tool');
      const profileSummary = mbt.contract
        ? (Array.isArray(mbt.effectiveProfiles) && mbt.effectiveProfiles.length
          ? mbt.effectiveProfiles.map((p) => `${escapeHtml(p.provider)}/${escapeHtml(p.model)}`).join('<br/>')
          : '<span class="hint">no profiles</span>')
        : '<span class="hint">n/a</span>';
      return `
        <tr>
          <td class="mono">${escapeHtml(row.name || '')}</td>
          <td>${typeBadge}</td>
          <td>${escapeHtml(row.class || '')}</td>
          <td>${escapeHtml(row.proofHint || '')}</td>
          <td class="mono">${profileSummary}</td>
        </tr>
      `;
    }).join('');
  }

  function renderSkills(skills = []) {
    const body = q('toolingSkillsBody');
    if (!body) return;
    if (!skills.length) {
      body.innerHTML = '<tr><td colspan="5" class="hint">No skills found.</td></tr>';
      return;
    }
    body.innerHTML = skills.map((skill) => {
      const approved = skill?.approved === true || String(skill?.verdict || '').toLowerCase() === 'safe';
      return `
        <tr>
          <td class="mono">${escapeHtml(skill?.name || '')}</td>
          <td>${badge(approved ? 'approved' : 'pending', approved ? 'good' : 'warn')}</td>
          <td>${escapeHtml(skill?.verdict || '-')}</td>
          <td>${Number(skill?.usageCount || 0)}</td>
          <td>${escapeHtml(skill?.lastUsedAt || skill?.updatedAt || '-')}</td>
        </tr>
      `;
    }).join('');
  }

  function renderModels(localModels = {}) {
    const body = q('toolingModelsBody');
    if (!body) return;
    const rows = Array.isArray(localModels?.recommended) ? localModels.recommended : [];
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="hint">No recommended local models configured.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((row) => `
      <tr>
        <td class="mono">${escapeHtml(row.model || '')}</td>
        <td>${badge(row.installed ? 'installed' : 'missing', row.installed ? 'good' : 'warn')}</td>
        <td>${badge(row.allowed ? 'allowlisted' : 'blocked', row.allowed ? 'good' : 'bad')}</td>
        <td>
          <button class="tooling-download-btn" data-model="${escapeHtml(row.model || '')}" ${row.installed ? 'disabled' : ''}>
            ${row.installed ? 'Installed' : 'Download'}
          </button>
        </td>
      </tr>
    `).join('');
  }

  function renderDownloads(downloads = {}) {
    const body = q('toolingDownloadsBody');
    if (!body) return;
    const rows = Array.isArray(downloads?.downloads) ? downloads.downloads : [];
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="hint">No local model download jobs.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((row) => {
      const statusLevel = row.status === 'succeeded'
        ? 'good'
        : row.status === 'failed' ? 'bad' : row.status === 'cancelled' ? 'warn' : '';
      const canCancel = row.status === 'queued' || row.status === 'running';
      return `
        <tr>
          <td class="mono">${escapeHtml(row.id || '')}</td>
          <td class="mono">${escapeHtml(row.model || '')}</td>
          <td>${badge(row.status || 'unknown', statusLevel)}</td>
          <td>${escapeHtml(row.createdAt || '-')}</td>
          <td>${escapeHtml(row.error || '-')}</td>
          <td>
            <button class="tooling-cancel-btn" data-job-id="${escapeHtml(row.id || '')}" ${canCancel ? '' : 'disabled'}>Cancel</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function syncRuntimeFields(mbt = {}) {
    if (q('mbtEnabled')) q('mbtEnabled').value = String(mbt.enabled === true);
    if (q('mbtExpose')) q('mbtExpose').value = String(mbt.exposeToController !== false);
    if (q('mbtConcurrency')) q('mbtConcurrency').value = String(Number(mbt.localMaxConcurrency || 1));
    if (q('mbtQueueDepth')) q('mbtQueueDepth').value = String(Number(mbt.queueDepth || 8));
  }

  function renderInventory() {
    syncRuntimeFields(inventory?.modelBackedTools || {});
    renderTools(inventory?.tools || []);
    renderSkills(inventory?.skills || []);
    renderModels(inventory?.localModels || {});
    renderDownloads(inventory?.localModels?.downloads || {});
  }

  async function refreshToolingInventory() {
    inventory = await jget('/api/runtime/tooling-inventory');
    renderInventory();
    return inventory;
  }

  async function refreshDownloadsOnly() {
    const out = await jget('/api/models/local/downloads');
    if (!inventory) inventory = {};
    if (!inventory.localModels) inventory.localModels = {};
    inventory.localModels.downloads = out;
    renderDownloads(out);
    return out;
  }

  async function saveRuntimeModelBackedConfig() {
    const localMaxConcurrency = Number(q('mbtConcurrency')?.value || 1);
    const queueDepth = Number(q('mbtQueueDepth')?.value || 8);
    await jpost('/api/config', {
      runtime: {
        modelBackedTools: {
          enabled: q('mbtEnabled')?.value === 'true',
          exposeToController: q('mbtExpose')?.value === 'true',
          localMaxConcurrency: Number.isFinite(localMaxConcurrency) ? localMaxConcurrency : 1,
          queueDepth: Number.isFinite(queueDepth) ? queueDepth : 8
        }
      }
    });
    setStatus('toolingStatus', 'saved model-backed tooling runtime settings', {
      type: 'success',
      title: 'Tooling'
    });
    await refreshRuntime();
    await refreshToolingInventory();
    await runWebuiWireValidation('tooling_runtime_save');
  }

  async function downloadModel(model) {
    const out = await jpost('/api/models/local/download', { model });
    setStatus('toolingStatus', out?.deduplicated
      ? `download already queued/running for ${model}`
      : `download queued for ${model}`, { type: 'success', title: 'Tooling' });
    await refreshToolingInventory();
  }

  async function cancelDownload(jobId) {
    const out = await jpost(`/api/models/local/downloads/${encodeURIComponent(jobId)}/cancel`, {});
    if (!out?.ok) {
      throw new Error(out?.error || 'cancel_failed');
    }
    setStatus('toolingStatus', `cancelled download ${jobId}`, { type: 'warn', title: 'Tooling' });
    await refreshDownloadsOnly();
  }

  function bindToolingActions() {
    q('refreshToolingInventory')?.addEventListener('click', () => {
      refreshToolingInventory().catch((err) => {
        setStatus('toolingStatus', `refresh failed: ${String(err?.message || err)}`, { type: 'error', title: 'Tooling' });
      });
    });
    q('refreshToolingDownloads')?.addEventListener('click', () => {
      refreshDownloadsOnly().catch((err) => {
        setStatus('toolingStatus', `download refresh failed: ${String(err?.message || err)}`, { type: 'error', title: 'Tooling' });
      });
    });
    q('saveToolingRuntime')?.addEventListener('click', () => {
      saveRuntimeModelBackedConfig().catch((err) => {
        setStatus('toolingStatus', `save failed: ${String(err?.message || err)}`, { type: 'error', title: 'Tooling' });
      });
    });
    q('toolingModelsBody')?.addEventListener('click', (event) => {
      const btn = event.target?.closest?.('.tooling-download-btn');
      const model = btn?.dataset?.model;
      if (!model) return;
      downloadModel(model).catch((err) => {
        setStatus('toolingStatus', `download failed: ${String(err?.message || err)}`, { type: 'error', title: 'Tooling' });
      });
    });
    q('toolingDownloadsBody')?.addEventListener('click', (event) => {
      const btn = event.target?.closest?.('.tooling-cancel-btn');
      const jobId = btn?.dataset?.jobId;
      if (!jobId) return;
      cancelDownload(jobId).catch((err) => {
        setStatus('toolingStatus', `cancel failed: ${String(err?.message || err)}`, { type: 'error', title: 'Tooling' });
      });
    });
  }

  return {
    bindToolingActions,
    refreshToolingInventory
  };
}
