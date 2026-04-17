import { describe, expect, it } from 'vitest';
import { createChatRuntimeService } from '../../src/server/services/chat_runtime.mjs';

function createService({ delayMs = 5, runtime = null } = {}) {
  const agent = {
    chat: async ({ message, sessionId }) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        sessionId,
        reply: `ok:${message}`,
        trace: {
          latency: {
            path: 'normal',
            providerMs: 3,
            continuationMs: 1,
            persistenceMs: 1,
            totalMs: delayMs + 4
          }
        }
      };
    },
    getCurrentModel: () => ({ provider: 'ollama-cloud', model: 'qwen3.5:397b-cloud' })
  };
  const config = {
    runtime: runtime || {
      chatHardTimeoutMs: 2000,
      pendingChatStuckMs: 100,
      chatCompletionCacheTtlMs: 4000
    }
  };
  return createChatRuntimeService({ agent, saveConfig: () => {}, config });
}

describe('chat runtime diagnostics', () => {
  it('reports pending entries with age/headroom', async () => {
    const svc = createService({ delayMs: 30 });
    const entry = svc.getOrStartChat('s1', 'hello');
    const diag = svc.getPendingDiagnostics({ includeCompleted: false });
    expect(diag.ok).toBe(true);
    expect(diag.pendingCount).toBeGreaterThanOrEqual(1);
    expect(diag.pending[0].sessionId).toBe('s1');
    expect(typeof diag.pending[0].ageMs).toBe('number');
    await entry.promise;
  });

  it('captures completed telemetry snapshot', async () => {
    const svc = createService({ delayMs: 5 });
    const entry = svc.getOrStartChat('s2', 'ping');
    const out = await entry.promise;
    expect(out.turnId).toBeTruthy();
    const diag = svc.getPendingDiagnostics({ includeCompleted: true });
    expect(diag.ok).toBe(true);
    expect(diag.completed.length).toBeGreaterThanOrEqual(1);
    expect(diag.completed[0].sessionId).toBe('s2');
  });

  it('defaults hard timeout to 300000ms when chatHardTimeoutMs is absent', () => {
    const svc = createService({
      delayMs: 5,
      runtime: {
        pendingChatStuckMs: 100,
        chatCompletionCacheTtlMs: 4000
      }
    });
    svc.getOrStartChat('s3', 'ping');
    const diag = svc.getPendingDiagnostics({ includeCompleted: false });
    expect(diag.pending[0].hardTimeoutMs).toBe(300000);
  });
});
