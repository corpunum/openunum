import { describe, expect, test } from 'vitest';
import { initializeUiState } from '../../src/ui/modules/ui-state-init.js';

function createStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    }
  };
}

describe('initializeUiState', () => {
  test('hydrates defaults and updates toggle labels', () => {
    const nodes = new Map([
      ['chatMeta', { textContent: '' }],
      ['autoEscalateToggle', { textContent: '' }],
      ['liveActivityToggle', { textContent: '' }]
    ]);
    const q = (id) => nodes.get(id);
    const storage = createStorage();
    const detailState = { open: true };

    const out = initializeUiState({
      localStorage: storage,
      q,
      loadDetailPanelState: () => detailState,
      defaultModelProviderIds: ['a'],
      defaultServiceProviderIds: ['svc'],
      createId: () => 'session-123'
    });

    expect(out.sessionId).toBe('session-123');
    expect(out.MODEL_PROVIDER_IDS).toEqual(['a']);
    expect(out.SERVICE_PROVIDER_IDS).toEqual(['svc']);
    expect(out.detailPanelState).toBe(detailState);
    expect(nodes.get('chatMeta').textContent).toBe('session-123');
    expect(nodes.get('autoEscalateToggle').textContent).toBe('Auto: On');
    expect(nodes.get('liveActivityToggle').textContent).toBe('Live: On');
  });
});

