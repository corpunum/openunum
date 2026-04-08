import { describe, it, expect } from 'vitest';
import {
  badgeClassForStatus,
  renderStatusBadge,
  providerSummaryText,
  serviceSummaryText
} from '../../src/ui/modules/provider-vault.js';

const escapeHtml = (s) => String(s || '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

describe('ui provider vault helpers', () => {
  it('maps status values to badge classes', () => {
    expect(badgeClassForStatus('healthy')).toBe('good');
    expect(badgeClassForStatus('degraded')).toBe('warn');
    expect(badgeClassForStatus('missing')).toBe('bad');
  });

  it('renders status badge html', () => {
    const html = renderStatusBadge('configured', escapeHtml);
    expect(html.includes('badge good')).toBe(true);
    expect(html.includes('configured')).toBe(true);
  });

  it('builds provider and service summary text', () => {
    expect(providerSummaryText({ top_model: 'm1', model_count: 3, base_url: 'https://example.com' })).toContain('#1 m1');
    expect(serviceSummaryText({ id: 'github', stored_preview: 'ghp***' })).toContain('stored ghp***');
  });
});
