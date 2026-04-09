import { describe, expect, it } from 'vitest';
import { buildControllerSystemMessage } from '../../src/core/context-pack-builder.mjs';

describe('buildControllerSystemMessage date grounding', () => {
  it('injects current runtime datetime guardrail', () => {
    const out = buildControllerSystemMessage({
      config: { runtime: { ownerControlMode: 'safe' } },
      executionProfile: { name: 'default', guidance: [], guardrails: [], verificationHints: [] },
      behavior: { classId: 'default', confidence: 1, source: 'test', description: 'x', needs: {} },
      provider: 'ollama-cloud',
      model: 'minimax-m2.7:cloud'
    });
    expect(out).toContain('Current runtime datetime (UTC):');
    expect(out).toContain('Current date:');
  });
});
