export function badgeClassForStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'healthy' || normalized === 'configured' || normalized === 'authenticated') return 'good';
  if (normalized === 'degraded' || normalized === 'partial') return 'warn';
  if (normalized === 'missing' || normalized === 'unavailable') return 'bad';
  return '';
}

export function renderStatusBadge(text, escapeHtml) {
  const value = String(text || 'unknown');
  return `<span class="badge ${badgeClassForStatus(value)}">${escapeHtml(value)}</span>`;
}

export function providerSummaryText(provider = {}) {
  const parts = [];
  if (provider.top_model) parts.push(`#1 ${provider.top_model}`);
  parts.push(`${Number(provider.model_count || 0)} models`);
  if (provider.base_url) parts.push(String(provider.base_url).replace(/^https?:\/\//, ''));
  return parts.join(' | ');
}

export function serviceSummaryText(row = {}) {
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
