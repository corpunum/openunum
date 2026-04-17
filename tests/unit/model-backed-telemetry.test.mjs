import { describe, expect, it } from 'vitest';
import { ModelBackedToolsTelemetry } from '../../src/tools/backends/telemetry.mjs';

describe('model-backed telemetry ordering', () => {
  it('keeps declared order until min samples reached', () => {
    const telemetry = new ModelBackedToolsTelemetry({
      runtime: {
        modelBackedTools: {
          autoProfileTuningEnabled: true,
          profileSwitchMinSamples: 6
        }
      }
    });
    const profiles = [
      { id: 'local', provider: 'ollama-local', model: 'ollama-local/gemma4:cpu' },
      { id: 'cloud', provider: 'ollama-cloud', model: 'ollama-cloud/qwen3.5:397b-cloud' }
    ];
    const ordered = telemetry.orderProfiles('summarize', profiles);
    expect(ordered.map((p) => p.id)).toEqual(['local', 'cloud']);
  });

  it('reorders profiles based on success/latency after enough samples', () => {
    const telemetry = new ModelBackedToolsTelemetry({
      runtime: {
        modelBackedTools: {
          autoProfileTuningEnabled: true,
          profileSwitchMinSamples: 6,
          latencyWeight: 0.5,
          costWeight: 0.2,
          failurePenalty: 1.0
        }
      }
    });
    const local = { id: 'local', provider: 'ollama-local', model: 'ollama-local/gemma4:cpu' };
    const cloud = { id: 'cloud', provider: 'ollama-cloud', model: 'ollama-cloud/qwen3.5:397b-cloud' };

    // Local profile underperforms
    for (let i = 0; i < 6; i += 1) {
      telemetry.record('summarize', local, { ok: false, latencyMs: 26000, error: 'timeout' });
    }
    // Cloud profile performs better
    for (let i = 0; i < 6; i += 1) {
      telemetry.record('summarize', cloud, { ok: true, latencyMs: 8000 });
    }

    const ordered = telemetry.orderProfiles('summarize', [local, cloud]);
    expect(ordered[0].id).toBe('cloud');
  });
});
