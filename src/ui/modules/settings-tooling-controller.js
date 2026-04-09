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

function defaultArgsForTool(name) {
  const tool = String(name || '').trim();
  if (tool === 'summarize') return { text: 'OpenUnum operational hardening summary.', maxSentences: 2 };
  if (tool === 'classify') return { text: 'Please classify this as greeting, task, or research intent.' };
  if (tool === 'extract') return { text: 'Owner: OpenUnum; Priority: high; Milestone: phase-ops.', fields: ['owner', 'priority', 'milestone'] };
  return { text: 'OpenUnum tool test input.' };
}

function normalizeToolProfile(profile = {}, fallbackId = '') {
  return {
    id: String(profile.id || fallbackId).trim(),
    type: String(profile.type || 'model').trim(),
    provider: String(profile.provider || '').trim(),
    model: String(profile.model || '').trim(),
    timeoutMs: Number.isFinite(profile.timeoutMs) ? Number(profile.timeoutMs) : 20000
  };
}

export function createSettingsToolingController({
  q,
  qa,
  jget,
  jpost,
  setStatus,
  runWebuiWireValidation,
  refreshRuntime,
  closeVaultModal
}) {
  let inventory = null;
  const toolingModalState = { tool: '' };

  function runtimeSettings() {
    const mbt = inventory?.modelBackedTools || {};
    return {
      enabled: mbt.enabled === true,
      exposeToController: mbt.exposeToController !== false,
      localMaxConcurrency: Number(mbt.localMaxConcurrency || 1),
      queueDepth: Number(mbt.queueDepth || 8),
      autoProfileTuningEnabled: mbt.autoProfileTuningEnabled !== false,
      profileSwitchMinSamples: Number(mbt.profileSwitchMinSamples || 6),
      latencyWeight: Number(mbt.latencyWeight || 0.35),
      costWeight: Number(mbt.costWeight || 0.25),
      failurePenalty: Number(mbt.failurePenalty || 0.8)
    };
  }

  function toolConfigByName(name) {
    const tools = inventory?.modelBackedTools?.tools || {};
    return tools[String(name || '').trim()] || {};
  }

  function buildToolSummary(tool = {}) {
    const mbt = tool?.model_backed || {};
    const profiles = Array.isArray(mbt.effectiveProfiles) ? mbt.effectiveProfiles : [];
    if (!mbt.contract) {
      return 'Native runtime tool';
    }
    if (!profiles.length) {
      return 'No backend profiles configured';
    }
    return profiles.map((profile) => `${profile.provider}/${profile.model} (${Number(profile.timeoutMs || 0)}ms)`).join(' -> ');
  }

  function renderTools(rows = []) {
    const body = q('toolingToolsBody');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="hint">No tools available.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((tool) => {
      const mbt = tool?.model_backed || {};
      const status = !mbt.contract
        ? badge('native', '')
        : mbt.enabled
          ? badge('model-backed enabled', 'good')
          : badge('model-backed disabled', 'warn');
      const telemetry = Array.isArray(mbt.telemetry) ? mbt.telemetry : [];
      const lead = telemetry[0] || null;
      const telemetryText = lead
        ? `sr=${Math.round((Number(lead.successRate || 0) * 100))}% | lat=${Math.round(Number(lead.avgLatencyMs || 0))}ms | calls=${Number(lead.calls || 0)}`
        : 'no runtime telemetry yet';
      const envelopeBadge = tool.allowedInCurrentEnvelope
        ? badge('allowed in current envelope', 'good')
        : badge('blocked in current envelope', 'warn');
      const localProfiles = (Array.isArray(mbt.effectiveProfiles) ? mbt.effectiveProfiles : [])
        .filter((profile) => String(profile?.provider || '').includes('ollama-local') || String(profile?.model || '').startsWith('ollama-local/'))
        .map((profile) => String(profile.model || '').replace(/^ollama-local\//, '') || '-');
      const localModelCell = localProfiles.length
        ? `<span class="mono">${escapeHtml(localProfiles.join(', '))}</span>`
        : '<span class="hint">none</span>';
      const actions = mbt.contract
        ? `
          <button type="button" class="tooling-edit" data-tool="${escapeHtml(tool.name || '')}">Edit</button>
          <button type="button" class="tooling-test" data-tool="${escapeHtml(tool.name || '')}">Test</button>
        `
        : '<span class="hint">n/a</span>';
      return `
        <tr>
          <td><span class="mono">${escapeHtml(tool.name || '')}</span></td>
          <td>${status}<div style="margin-top:4px;">${envelopeBadge}</div></td>
          <td>${escapeHtml(tool.class || '-')}</td>
          <td><span class="mono">${escapeHtml(buildToolSummary(tool))}</span><div class="hint" style="margin-top:4px;">${escapeHtml(telemetryText)}</div></td>
          <td>${localModelCell}</td>
          <td><div class="row compact-actions">${actions}</div></td>
        </tr>
      `;
    }).join('');
    qa('.tooling-edit').forEach((btn) => {
      btn.onclick = () => openToolModal(btn.dataset.tool);
    });
    qa('.tooling-test').forEach((btn) => {
      btn.onclick = () => testTool(btn.dataset.tool).catch((err) => {
        setStatus('toolingStatus', `tool test failed: ${String(err?.message || err)}`, { type: 'error', title: 'Tooling' });
      });
    });
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
          <td>${escapeHtml(skill?.verdict || '-')}<div class="hint" style="margin-top:4px;">${escapeHtml(skill?.source || 'unknown')}</div></td>
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

  function syncRuntimeFields() {
    const rs = runtimeSettings();
    if (q('mbtEnabled')) q('mbtEnabled').value = String(rs.enabled);
    if (q('mbtExpose')) q('mbtExpose').value = String(rs.exposeToController);
    if (q('mbtConcurrency')) q('mbtConcurrency').value = String(rs.localMaxConcurrency);
    if (q('mbtQueueDepth')) q('mbtQueueDepth').value = String(rs.queueDepth);
    if (q('mbtAutoTune')) q('mbtAutoTune').value = String(rs.autoProfileTuningEnabled);
    if (q('mbtMinSamples')) q('mbtMinSamples').value = String(rs.profileSwitchMinSamples);
    if (q('mbtLatencyWeight')) q('mbtLatencyWeight').value = String(rs.latencyWeight);
    if (q('mbtCostWeight')) q('mbtCostWeight').value = String(rs.costWeight);
    if (q('mbtFailurePenalty')) q('mbtFailurePenalty').value = String(rs.failurePenalty);
  }

  function renderInventory() {
    syncRuntimeFields();
    renderTools(inventory?.tools || []);
    renderSkills(inventory?.skills || []);
    renderModels(inventory?.localModels || {});
    renderDownloads(inventory?.localModels?.downloads || {});
  }

  function toolModalValue(id) {
    return String(q(id)?.value || '').trim();
  }

  function openToolModal(toolName) {
    const safeTool = String(toolName || '').trim();
    if (!safeTool) return;
    const modal = q('toolingEditModal');
    const title = q('toolingEditTitle');
    const body = q('toolingEditBody');
    if (!modal || !title || !body) return;
    toolingModalState.tool = safeTool;
    const cfg = toolConfigByName(safeTool);
    const profiles = Array.isArray(cfg?.backendProfiles) ? cfg.backendProfiles : [];
    const primary = normalizeToolProfile(profiles[0], `${safeTool}.local`);
    const secondary = normalizeToolProfile(profiles[1], `${safeTool}.cloud`);
    title.textContent = `Tool Backend Profiles: ${safeTool}`;
    body.innerHTML = `
      <div class="field">
        <label>Tool</label>
        <input class="mono" value="${escapeHtml(safeTool)}" readonly />
      </div>
      <div class="grid two">
        <div class="field">
          <label>Primary Profile ID</label>
          <input id="toolingPrimaryId" class="mono" value="${escapeHtml(primary.id)}" />
        </div>
        <div class="field">
          <label>Primary Provider</label>
          <input id="toolingPrimaryProvider" class="mono" value="${escapeHtml(primary.provider || 'ollama-local')}" />
        </div>
        <div class="field">
          <label>Primary Model</label>
          <input id="toolingPrimaryModel" class="mono" value="${escapeHtml(primary.model || 'ollama-local/gemma4:cpu')}" />
        </div>
        <div class="field">
          <label>Primary Timeout (ms)</label>
          <input id="toolingPrimaryTimeout" type="number" min="1000" max="180000" value="${Number(primary.timeoutMs || 20000)}" />
        </div>
      </div>
      <div class="grid two" style="margin-top:10px;">
        <div class="field">
          <label>Fallback Profile ID</label>
          <input id="toolingFallbackId" class="mono" value="${escapeHtml(secondary.id || `${safeTool}.cloud`)}" />
        </div>
        <div class="field">
          <label>Fallback Provider</label>
          <input id="toolingFallbackProvider" class="mono" value="${escapeHtml(secondary.provider || 'ollama-cloud')}" />
        </div>
        <div class="field">
          <label>Fallback Model</label>
          <input id="toolingFallbackModel" class="mono" value="${escapeHtml(secondary.model || 'ollama-cloud/minimax-m2.7:cloud')}" />
        </div>
        <div class="field">
          <label>Fallback Timeout (ms)</label>
          <input id="toolingFallbackTimeout" type="number" min="1000" max="180000" value="${Number(secondary.timeoutMs || 25000)}" />
        </div>
      </div>
      <div class="hint">Leave fallback provider/model empty to store only primary profile.</div>
      <div class="soft-panel" style="margin-top:10px;">
        <div class="section-title">Contract Template</div>
        <div class="hint"><strong>Purpose:</strong> ${escapeHtml(inventory?.modelBackedTools?.contractTemplates?.[safeTool]?.purpose || '-')}</div>
        <div class="hint"><strong>Required Output Fields:</strong> ${escapeHtml((inventory?.modelBackedTools?.contractTemplates?.[safeTool]?.outputSchema?.requiredDataFields || []).join(', ') || '-')}</div>
        <div class="hint"><strong>Confidence Min:</strong> ${escapeHtml(String(inventory?.modelBackedTools?.contractTemplates?.[safeTool]?.outputSchema?.confidenceMin ?? '-'))}</div>
      </div>
    `;
    modal.showModal();
  }

  async function saveToolModal() {
    const tool = String(toolingModalState.tool || '').trim();
    if (!tool) return;
    const primaryProvider = toolModalValue('toolingPrimaryProvider');
    const primaryModel = toolModalValue('toolingPrimaryModel');
    const fallbackProvider = toolModalValue('toolingFallbackProvider');
    const fallbackModel = toolModalValue('toolingFallbackModel');
    const profiles = [];
    if (primaryProvider && primaryModel) {
      profiles.push({
        id: toolModalValue('toolingPrimaryId') || `${tool}.local`,
        type: 'model',
        provider: primaryProvider,
        model: primaryModel,
        timeoutMs: Number(q('toolingPrimaryTimeout')?.value || 20000)
      });
    }
    if (fallbackProvider && fallbackModel) {
      profiles.push({
        id: toolModalValue('toolingFallbackId') || `${tool}.cloud`,
        type: 'model',
        provider: fallbackProvider,
        model: fallbackModel,
        timeoutMs: Number(q('toolingFallbackTimeout')?.value || 25000)
      });
    }
    await jpost('/api/config', {
      runtime: {
        modelBackedTools: {
          tools: {
            [tool]: {
              backendProfiles: profiles
            }
          }
        }
      }
    });
    setStatus('toolingStatus', `saved backend profiles for ${tool}`, { type: 'success', title: 'Tooling' });
    closeVaultModal('toolingEditModal');
    await refreshToolingInventory();
    await runWebuiWireValidation(`tooling_profile_save:${tool}`);
  }

  async function testTool(toolName) {
    const tool = String(toolName || '').trim();
    if (!tool) return;
    const out = await jpost('/api/tool/run', {
      name: tool,
      args: defaultArgsForTool(tool),
      sessionId: `tooling-test:${tool}:${Date.now()}`
    }, { timeoutMs: 45000 });
    const ok = out?.ok && out?.result?.ok !== false;
    const status = ok
      ? `tool ${tool} test ok`
      : `tool ${tool} test failed: ${String(out?.result?.error || out?.error || 'unknown')}`;
    setStatus('toolingStatus', status, { type: ok ? 'success' : 'error', title: 'Tooling' });
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
          queueDepth: Number.isFinite(queueDepth) ? queueDepth : 8,
          autoProfileTuningEnabled: q('mbtAutoTune')?.value === 'true',
          profileSwitchMinSamples: Number(q('mbtMinSamples')?.value || 6),
          latencyWeight: Number(q('mbtLatencyWeight')?.value || 0.35),
          costWeight: Number(q('mbtCostWeight')?.value || 0.25),
          failurePenalty: Number(q('mbtFailurePenalty')?.value || 0.8)
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

  async function applyCoreDefaults() {
    await jpost('/api/config', {
      runtime: {
        modelBackedTools: {
          enabled: true,
          exposeToController: true,
          localMaxConcurrency: 1,
          queueDepth: 8,
          autoProfileTuningEnabled: true,
          profileSwitchMinSamples: 6,
          latencyWeight: 0.35,
          costWeight: 0.25,
          failurePenalty: 0.8,
          recommendedLocalModels: [
            'gemma4:cpu',
            'nomic-embed-text:latest',
            'mxbai-embed-large:latest',
            'all-minilm:latest'
          ],
          tools: {
            summarize: {
              backendProfiles: [
                { id: 'summarize.local', type: 'model', provider: 'ollama-local', model: 'ollama-local/gemma4:cpu', timeoutMs: 22000 },
                { id: 'summarize.cloud', type: 'model', provider: 'ollama-cloud', model: 'ollama-cloud/minimax-m2.7:cloud', timeoutMs: 28000 }
              ]
            },
            classify: {
              backendProfiles: [
                { id: 'classify.local', type: 'model', provider: 'ollama-local', model: 'ollama-local/gemma4:cpu', timeoutMs: 18000 },
                { id: 'classify.cloud', type: 'model', provider: 'ollama-cloud', model: 'ollama-cloud/minimax-m2.7:cloud', timeoutMs: 25000 }
              ]
            },
            extract: {
              backendProfiles: [
                { id: 'extract.local', type: 'model', provider: 'ollama-local', model: 'ollama-local/gemma4:cpu', timeoutMs: 20000 },
                { id: 'extract.cloud', type: 'model', provider: 'ollama-cloud', model: 'ollama-cloud/minimax-m2.7:cloud', timeoutMs: 28000 }
              ]
            }
          }
        }
      }
    });
    setStatus('toolingStatus', 'applied core defaults for model-backed tools', { type: 'success', title: 'Tooling' });
    await refreshRuntime();
    await refreshToolingInventory();
    await runWebuiWireValidation('tooling_apply_core_defaults');
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
    if (!out?.ok) throw new Error(out?.error || 'cancel_failed');
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
    q('applyToolingCoreDefaults')?.addEventListener('click', () => {
      applyCoreDefaults().catch((err) => {
        setStatus('toolingStatus', `apply defaults failed: ${String(err?.message || err)}`, { type: 'error', title: 'Tooling' });
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

    q('toolingEditSave')?.addEventListener('click', () => {
      saveToolModal().catch((err) => {
        setStatus('toolingStatus', `tool profile save failed: ${String(err?.message || err)}`, { type: 'error', title: 'Tooling' });
      });
    });
    q('toolingEditTest')?.addEventListener('click', () => {
      const tool = String(toolingModalState.tool || '').trim();
      if (!tool) return;
      testTool(tool).catch((err) => {
        setStatus('toolingStatus', `tool test failed: ${String(err?.message || err)}`, { type: 'error', title: 'Tooling' });
      });
    });
    q('toolingEditClose')?.addEventListener('click', () => closeVaultModal('toolingEditModal'));
    q('toolingEditCloseTop')?.addEventListener('click', () => closeVaultModal('toolingEditModal'));
  }

  return {
    bindToolingActions,
    refreshToolingInventory,
    applyCoreDefaults
  };
}
