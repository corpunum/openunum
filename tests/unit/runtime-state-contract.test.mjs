import { describe, it, expect } from 'vitest';
import {
  RUNTIME_STATE_CONTRACT_VERSION,
  buildRuntimeStatePacket,
  computeRuntimeStateFingerprint,
  createCanonicalRuntimeState,
  validateCanonicalRuntimeState
} from '../../src/core/runtime-state-contract.mjs';

describe('runtime-state-contract', () => {
  it('creates canonical state with expected defaults', () => {
    const state = createCanonicalRuntimeState({
      goal: 'Test goal',
      nextAction: 'Do test action'
    });

    expect(state.contractVersion).toBe(RUNTIME_STATE_CONTRACT_VERSION);
    expect(state.goal).toBe('Test goal');
    expect(state.nextAction).toBe('Do test action');
    expect(Array.isArray(state.verifiedObservations)).toBe(true);
    expect(typeof state.permissions.shell).toBe('boolean');
  });

  it('validates required fields', () => {
    const bad = createCanonicalRuntimeState({ goal: '', nextAction: '' });
    const result = validateCanonicalRuntimeState(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('goal'))).toBe(true);
    expect(result.errors.some((e) => e.includes('nextAction'))).toBe(true);
  });

  it('creates deterministic fingerprint regardless of key order', () => {
    const a = {
      goal: 'Same goal',
      nextAction: 'Same action',
      permissions: { shell: true, network: false, browser: false, fileWrite: false },
      metadata: { b: 2, a: 1 }
    };
    const b = {
      nextAction: 'Same action',
      metadata: { a: 1, b: 2 },
      permissions: { browser: false, network: false, fileWrite: false, shell: true },
      goal: 'Same goal'
    };

    const fa = computeRuntimeStateFingerprint(a);
    const fb = computeRuntimeStateFingerprint(b);
    expect(fa).toBe(fb);
  });

  it('builds packet with fingerprint and state', () => {
    const packet = buildRuntimeStatePacket({
      goal: 'Packet goal',
      nextAction: 'Packet action'
    });

    expect(packet.contractVersion).toBe(RUNTIME_STATE_CONTRACT_VERSION);
    expect(typeof packet.fingerprint).toBe('string');
    expect(packet.fingerprint.length).toBe(64);
    expect(packet.state.goal).toBe('Packet goal');
  });
});
