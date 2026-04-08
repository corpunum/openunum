import { describe, it, expect } from 'vitest';
import {
  pendingPollDelayMs,
  formatRelativeTime,
  newestAssistantSince,
  isStatusCheckMessage,
  isPlanningReply,
  shouldEscalateToAuto,
  formatProviderModel,
  stripProviderPrefix
} from '../../src/ui/modules/logic.js';

describe('ui logic module', () => {
  it('uses bounded adaptive pending poll delays', () => {
    expect(pendingPollDelayMs(0)).toBe(700);
    expect(pendingPollDelayMs(2)).toBe(1000);
    expect(pendingPollDelayMs(6)).toBe(1400);
    expect(pendingPollDelayMs(12)).toBe(1800);
  });

  it('formats relative time for recent minutes', () => {
    const iso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso)).toBe('5m');
  });

  it('selects newest assistant message since timestamp', () => {
    const older = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const newer = new Date(Date.now() - 60 * 1000).toISOString();
    const found = newestAssistantSince([
      { role: 'assistant', content: 'old', created_at: older },
      { role: 'user', content: 'u', created_at: newer },
      { role: 'assistant', content: 'new', created_at: newer }
    ], older);
    expect(found?.content).toBe('new');
  });

  it('detects status-check and planning messages', () => {
    expect(isStatusCheckMessage('status?')).toBe(true);
    expect(isStatusCheckMessage('hello')).toBe(false);
    expect(isPlanningReply({ reply: 'I will continue with step 2' })).toBe(true);
    expect(isPlanningReply({ reply: 'done' })).toBe(false);
  });

  it('escalates planning-only replies when tools already ran', () => {
    const out = {
      reply: 'I will continue and create the next step',
      trace: {
        iterations: [
          { toolCalls: [{ tool: 'read' }], assistantText: 'checking' },
          { toolCalls: [], assistantText: 'I will continue and create next step' }
        ]
      }
    };
    expect(shouldEscalateToAuto('do it', out, true)).toBe(true);
    expect(shouldEscalateToAuto('status?', out, true)).toBe(false);
    expect(shouldEscalateToAuto('do it', out, false)).toBe(false);
  });

  it('normalizes provider/model refs consistently', () => {
    expect(formatProviderModel('generic', 'gpt-5')).toBe('openai/gpt-5');
    expect(formatProviderModel('ollama', 'qwen3.5:9b')).toBe('ollama-cloud/qwen3.5:9b');
    expect(stripProviderPrefix('ollama-cloud/minimax-m2.7:cloud', ['ollama-cloud'])).toBe('minimax-m2.7:cloud');
    expect(stripProviderPrefix('openai/gpt-5', ['openai'])).toBe('gpt-5');
  });
});
