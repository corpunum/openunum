import { describe, it, expect } from 'vitest';
import {
  loadDetailPanelState,
  detailPanelKey,
  rememberDetailPanelState
} from '../../src/ui/modules/detail-panels.js';

describe('ui detail panel persistence helpers', () => {
  it('loads valid stored state and falls back to empty on invalid JSON', () => {
    const okStore = {
      getItem: () => '{"chat:trace":{"open":true}}'
    };
    const badStore = {
      getItem: () => '{bad-json'
    };
    expect(loadDetailPanelState(okStore)).toEqual({ 'chat:trace': { open: true } });
    expect(loadDetailPanelState(badStore)).toEqual({});
  });

  it('creates stable detail panel keys', () => {
    expect(detailPanelKey('session-1', 'trace')).toBe('session-1:trace');
    expect(detailPanelKey('', 'trace')).toBe('global:trace');
  });

  it('merges and persists detail panel state updates', () => {
    const writes = [];
    const storage = {
      setItem: (k, v) => writes.push([k, v])
    };
    const state = { 'session-1:trace': { open: true } };
    rememberDetailPanelState(state, 'session-1:trace', { scrollTop: 42 }, storage);
    expect(state['session-1:trace']).toEqual({ open: true, scrollTop: 42 });
    expect(writes.length).toBe(1);
    expect(writes[0][0]).toBe('openunum_detail_panels');
  });
});
