export function buildMissionTimelineView(out, { filter = 'all', search = '', escapeHtml }) {
  const safeFilter = String(filter || 'all');
  const needle = String(search || '').trim().toLowerCase();
  const match = (text) => !needle || String(text || '').toLowerCase().includes(needle);

  const mission = out?.mission || {};
  const stepLimit = mission.effectiveStepLimit || mission.hardStepCap || mission.maxSteps;
  const limitLabel = mission.limitSource === 'hardStepCap' ? 'hard-cap' : 'max-steps';
  const summaryText =
    `status=${mission.status} step=${mission.step}/${stepLimit} limit=${limitLabel} retries=${Number(mission.retries || 0)} session=${mission.sessionId}`;

  const logItems = (out?.log || []).slice(-8).reverse()
    .filter((item) => match(`${item.at} ${item.reply || ''} ${item.selfPoke || ''}`))
    .map((item) => `<div class="ledger-item">step ${Number(item.step || 0)} | ${escapeHtml(item.at || '')} | ${escapeHtml(String(item.reply || item.selfPoke || '').slice(0, 180))}</div>`)
    .join('');
  const logHtml = (safeFilter === 'all' || safeFilter === 'log')
    ? `<strong>Mission log</strong>${logItems || '<div class="ledger-item">No mission log entries match.</div>'}`
    : '';

  const toolItems = (out?.toolRuns || []).slice(-8).reverse()
    .filter((item) => match(`${item.toolName} ${item.createdAt} ${JSON.stringify(item.result || {})}`))
    .map((item) => `<div class="ledger-item">tool ${escapeHtml(item.toolName)} | ok=${escapeHtml(String(item.ok))} | ${escapeHtml(item.createdAt || '')}</div>`)
    .join('');
  const strategyItems = (out?.recentStrategies || []).slice(0, 6)
    .filter((item) => match(`${item.strategy} ${item.evidence} ${item.goal}`))
    .map((item) => `<div class="ledger-item">${escapeHtml(item.success ? 'SUCCESS' : 'FAIL')} | ${escapeHtml(item.strategy)} | ${escapeHtml(String(item.evidence || '').slice(0, 100))}</div>`)
    .join('');
  const compactionItems = (out?.compactions || []).slice(0, 5)
    .filter((item) => match(`${item.model} ${item.createdAt} ${JSON.stringify(item.summary || {})}`))
    .map((item) => `<div class="ledger-item">compaction | ${escapeHtml(item.model)} | pre=${Number(item.preTokens || 0)} post=${Number(item.postTokens || 0)} | ${escapeHtml(item.createdAt || '')}</div>`)
    .join('');
  const toolsHtml = (safeFilter === 'all' || safeFilter === 'tools' || safeFilter === 'strategies' || safeFilter === 'compactions')
    ? `<strong>Tool and strategy trail</strong>${safeFilter === 'all' || safeFilter === 'tools' ? (toolItems || '') : ''}${safeFilter === 'all' || safeFilter === 'strategies' ? (strategyItems || '') : ''}${safeFilter === 'all' || safeFilter === 'compactions' ? (compactionItems || '') : ''}${toolItems || strategyItems || compactionItems ? '' : '<div class="ledger-item">No matching trail entries.</div>'}`
    : '';

  const artifacts = Array.isArray(out?.artifacts) ? out.artifacts : [];
  const artifactEntries = artifacts
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .filter(({ item }) => match(`${item.type} ${item.content} ${item.sourceRef || ''}`))
    .slice(0, 8);
  const artifactItems = artifactEntries
    .map(({ item, sourceIndex }) => `<button type="button" class="menu-btn" data-artifact-index="${sourceIndex}" style="width:100%;margin:4px 0;text-align:left;">${escapeHtml(item.type)} | ${escapeHtml(String(item.content || '').slice(0, 90))}</button>`)
    .join('');
  const artifactsHtml = (safeFilter === 'all' || safeFilter === 'artifacts')
    ? `<strong>Artifacts</strong>${artifactItems || '<div class="ledger-item">No matching artifacts.</div>'}`
    : '';

  return { summaryText, logHtml, toolsHtml, artifactsHtml };
}
