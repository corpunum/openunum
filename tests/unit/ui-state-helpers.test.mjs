import { describe, expect, test } from 'vitest';
import { createUiStateHelpers } from '../../src/ui/modules/ui-state-helpers.js';

describe('createUiStateHelpers', () => {
  test('updates composer state from pending sessions', () => {
    const nodes = new Map([
      ['send', { disabled: false }],
      ['message', { placeholder: '' }]
    ]);
    const q = (id) => nodes.get(id);
    const pendingSessions = new Set(['s1']);
    let currentSession = 's1';

    const helpers = createUiStateHelpers({
      q,
      localStorage: {},
      pendingSessions,
      getSessionId: () => currentSession,
      getDetailPanelState: () => ({}),
      rememberDetailPanelStateWithStorage: () => {},
      showViewWithMeta: () => {},
      viewMeta: {}
    });

    helpers.updateComposerPendingState();
    expect(nodes.get('send').disabled).toBe(true);

    currentSession = 's2';
    helpers.updateComposerPendingState();
    expect(nodes.get('send').disabled).toBe(false);
  });
});

