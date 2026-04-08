import { describe, it, expect } from 'vitest';
import { buildMissionTimelineView } from '../../src/ui/modules/missions.js';

const escapeHtml = (s) => String(s || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

describe('ui missions helpers', () => {
  it('builds filtered mission timeline sections', () => {
    const out = {
      mission: { status: 'running', step: 2, hardStepCap: 6, retries: 1, sessionId: 's-1' },
      log: [{ step: 2, at: '2026-04-08T00:00:00Z', reply: 'alpha done' }],
      toolRuns: [{ toolName: 'beta-tool', ok: true, createdAt: '2026-04-08T00:00:01Z', result: { ok: true } }],
      recentStrategies: [],
      compactions: [],
      artifacts: [{ type: 'note', content: 'delta artifact', sourceRef: 'src' }]
    };
    const view = buildMissionTimelineView(out, { filter: 'log', search: 'alpha', escapeHtml });
    expect(view.summaryText.includes('status=running')).toBe(true);
    expect(view.logHtml.includes('alpha done')).toBe(true);
    expect(view.toolsHtml).toBe('');
  });

  it('keeps artifact source indices when filtered', () => {
    const out = {
      mission: { status: 'running', step: 1, maxSteps: 2, retries: 0, sessionId: 's-2' },
      artifacts: [
        { type: 'note', content: 'first artifact', sourceRef: 'a' },
        { type: 'note', content: 'second target', sourceRef: 'b' }
      ]
    };
    const view = buildMissionTimelineView(out, { filter: 'artifacts', search: 'second', escapeHtml });
    expect(view.artifactsHtml.includes('data-artifact-index="1"')).toBe(true);
    expect(view.artifactsHtml.includes('data-artifact-index="0"')).toBe(false);
  });
});
