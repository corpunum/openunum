import { describe, it, expect, vi } from 'vitest';
import { AutonomyMaster } from '../../src/core/autonomy-master.mjs';

describe('AutonomyMaster predictive recovery mapping', () => {
  it('maps cleanup_logs to disk_space_low recovery issue type', async () => {
    const recover = vi.fn().mockResolvedValue({ success: true, action: 'ok' });
    const ctx = {
      autoRecover: { recover },
      config: { model: { provider: 'ollama' } }
    };

    const result = await AutonomyMaster.prototype.handlePrediction.call(ctx, {
      action: 'cleanup_logs',
      severity: 'warning',
      type: 'disk_space_critical'
    });

    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'disk_space_low',
        severity: 'warning'
      })
    );
    expect(result).toEqual({ success: true, action: 'ok' });
  });

  it('maps restart_browser to browser_cdp_unreachable issue type', async () => {
    const recover = vi.fn().mockResolvedValue({ success: true, action: 'browser_ok' });
    const ctx = {
      autoRecover: { recover },
      config: { model: { provider: 'ollama' } }
    };

    await AutonomyMaster.prototype.handlePrediction.call(ctx, {
      action: 'restart_browser',
      severity: 'critical',
      type: 'browser_unstable'
    });

    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'browser_cdp_unreachable',
        severity: 'critical'
      })
    );
  });

  it('maps switch_fallback to model_provider_timeout with current provider context', async () => {
    const recover = vi.fn().mockResolvedValue({ success: true, action: 'provider_switched' });
    const ctx = {
      autoRecover: { recover },
      config: { model: { provider: 'openrouter' } }
    };

    await AutonomyMaster.prototype.handlePrediction.call(ctx, {
      action: 'switch_fallback',
      severity: 'warning',
      type: 'provider_unstable'
    });

    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'model_provider_timeout',
        details: expect.objectContaining({ currentProvider: 'openrouter' })
      })
    );
  });
});

describe('AutonomyMaster predictive signal parsing', () => {
  it('detects disk pressure from orchestrator disk check key', async () => {
    const ctx = {
      thresholds: { diskUsagePercent: 85 }
    };

    const predictions = await AutonomyMaster.prototype.analyzePredictiveFailures.call(ctx, {
      issues: [{ check: 'disk', details: { usedPercent: 91 } }]
    });

    expect(predictions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'disk_space_critical',
          action: 'cleanup_logs',
          severity: 'critical'
        })
      ])
    );
  });
});
