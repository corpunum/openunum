import { describe, it, expect } from 'vitest';
import { sortSessionsByRecency, filterSessionsByQuery } from '../../src/ui/modules/sessions.js';

describe('ui sessions helpers', () => {
  it('sorts sessions by recency descending', () => {
    const rows = [
      { sessionId: 'a', lastMessageAt: '2026-01-01T00:00:00.000Z' },
      { sessionId: 'b', lastMessageAt: '2026-01-02T00:00:00.000Z' }
    ];
    const out = sortSessionsByRecency(rows);
    expect(out.map((r) => r.sessionId)).toEqual(['b', 'a']);
  });

  it('filters sessions by id/title/preview query', () => {
    const rows = [
      { sessionId: 'abc', title: 'First Chat', preview: 'hello world' },
      { sessionId: 'xyz', title: 'Second', preview: 'planning run' }
    ];
    expect(filterSessionsByQuery(rows, 'hello').map((r) => r.sessionId)).toEqual(['abc']);
    expect(filterSessionsByQuery(rows, 'xyz').map((r) => r.sessionId)).toEqual(['xyz']);
    expect(filterSessionsByQuery(rows, '')).toEqual(rows);
  });
});
