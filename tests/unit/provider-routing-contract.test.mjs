import { describe, expect, it, beforeEach } from 'vitest';
import { classifyControllerBehavior, resetAllLearnedBehaviors } from '../../src/core/model-behavior-registry.mjs';
import {
  formatProviderFailureReply,
  getExecutionProfile,
  mergeProfileWithBehavior
} from '../../src/core/agent-helpers.mjs';

describe('provider routing contract', () => {
  beforeEach(() => {
    resetAllLearnedBehaviors();
  });

  it('preserves the widened qwen cloud turn budget after behavior merge', () => {
    const behavior = classifyControllerBehavior({
      provider: 'ollama-cloud',
      model: 'qwen3.5:397b-cloud',
      config: { model: { behaviorOverrides: {} } }
    });
    const merged = mergeProfileWithBehavior(
      getExecutionProfile('ollama-cloud', 'qwen3.5:397b-cloud'),
      behavior,
      { runtime: { agentTurnTimeoutMs: 420000 } }
    );

    expect(merged.turnBudgetMs).toBe(180000);
    expect(merged.maxIters).toBe(4);
  });

  it('formats strict primary timeout replies honestly', () => {
    const reply = formatProviderFailureReply({
      failures: [
        {
          provider: 'ollama-cloud',
          kind: 'timeout',
          action: 'no_alternative_route',
          error: 'Ollama provider timeout after 60000ms'
        }
      ],
      effectiveAttempts: [
        { provider: 'ollama-cloud', model: 'qwen3.5:397b-cloud' }
      ],
      routing: {
        forcePrimaryProvider: true,
        fallbackEnabled: false
      }
    });

    expect(reply).toContain('Primary provider failed.');
    expect(reply).toContain('forcePrimaryProvider');
    expect(reply).toContain('exhausted its turn budget');
    expect(reply).not.toContain('All configured providers failed');
  });

  it('keeps multi-provider summaries for actual fallback pools', () => {
    const reply = formatProviderFailureReply({
      failures: [
        {
          provider: 'ollama-cloud',
          kind: 'timeout',
          action: 'switch_provider',
          error: 'timeout'
        },
        {
          provider: 'nvidia',
          kind: 'network',
          action: 'switch_provider',
          error: 'fetch failed'
        }
      ],
      effectiveAttempts: [
        { provider: 'ollama-cloud', model: 'qwen3.5:397b-cloud' },
        { provider: 'nvidia', model: 'meta/llama-3.1-405b-instruct' }
      ],
      routing: {
        forcePrimaryProvider: false,
        fallbackEnabled: true
      }
    });

    expect(reply).toContain('All provider attempts failed.');
    expect(reply).not.toContain('forcePrimaryProvider');
  });
});
