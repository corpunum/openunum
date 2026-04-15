import { describe, it, expect } from 'vitest';
import { ContextPressure } from '../../src/core/context-pressure.mjs';

describe('ContextPressure', () => {
  it('uses the instance default max token budget when no override is provided', () => {
    const pressure = new ContextPressure({ maxTokens: 8000 });
    const messages = [{ role: 'user', content: 'x'.repeat(32000) }];
    const report = pressure.getReport(messages);

    expect(report.tokensMax).toBe(8000);
    expect(report.status).toBe('critical');
  });

  it('accepts a runtime override for the active model context budget', () => {
    const pressure = new ContextPressure({ maxTokens: 8000 });
    const messages = [{ role: 'user', content: 'x'.repeat(32000) }];
    const report = pressure.getReport(messages, { maxTokens: 16000 });

    expect(report.tokensMax).toBe(16000);
    expect(report.status).toBe('ok');
    expect(report.usagePercent).toBeLessThan(70);
  });
});
