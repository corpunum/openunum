import { describe, it, expect } from 'vitest';
import { inferFinalizationState } from '../../src/core/agent.mjs';

describe('inferFinalizationState', () => {
  it('marks rejected completion text as partial', () => {
    const finalization = inferFinalizationState({
      finalText: [
        'Completion claim was rejected by execution contract: insufficient proof-backed tool evidence in this turn.',
        'MISSION_STATUS: CONTINUE'
      ].join('\n'),
      trace: {},
      progress: { hasTask: false, total: 0, percent: 0 }
    });
    expect(finalization.state).toBe('partial');
    expect(finalization.hasFailureSignal).toBe(true);
  });

  it('marks contradictory ok-plus-failure summaries as partial', () => {
    const finalization = inferFinalizationState({
      finalText: [
        'Status: ok',
        'Findings:',
        'web_fetch: ❌ failed'
      ].join('\n'),
      trace: {},
      progress: { hasTask: false, total: 0, percent: 0 }
    });
    expect(finalization.state).toBe('partial');
    expect(finalization.hasFailureSignal).toBe(true);
  });
});
