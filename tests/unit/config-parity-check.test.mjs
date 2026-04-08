import { describe, it, expect } from 'vitest';
import { buildConfigParityReport, evaluateFourBProfileReadiness } from '../../src/core/config-parity-check.mjs';

function baseConfig() {
  return {
    runtime: {
      workspaceRoot: '/tmp/openunum',
      contextCompactionEnabled: true,
      modelExecutionProfiles: {
        compact: {
          maxHistoryMessages: 220,
          maxToolIterations: 3
        }
      }
    },
    model: {
      provider: 'ollama-cloud',
      providerModels: {
        'ollama-cloud': 'ollama-cloud/minimax-m2.7:cloud',
        openrouter: 'openrouter/openai/gpt-4o-mini'
      },
      routing: {
        fallbackProviders: ['openrouter']
      },
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      openrouterBaseUrl: 'https://openrouter.ai/api/v1',
      openrouterApiKey: 'sk-test'
    }
  };
}

describe('config-parity-check', () => {
  it('returns ok for valid baseline config', () => {
    const report = buildConfigParityReport(baseConfig(), {});
    expect(report.ok).toBe(true);
    expect(report.summary.errorCount).toBe(0);
  });

  it('flags missing provider model for fallback provider', () => {
    const cfg = baseConfig();
    delete cfg.model.providerModels.openrouter;
    const report = buildConfigParityReport(cfg, {});
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === 'provider_model_missing')).toBe(true);
  });

  it('flags missing API key for non-ollama fallback provider', () => {
    const cfg = baseConfig();
    cfg.model.openrouterApiKey = '';
    const report = buildConfigParityReport(cfg, {});
    expect(report.ok).toBe(true);
    expect(report.issues.some((i) => i.code === 'provider_api_key_missing')).toBe(true);
  });

  it('flags 4B profile warnings when compact budget too large', () => {
    const issues = evaluateFourBProfileReadiness({
      runtime: {
        contextCompactionEnabled: false,
        modelExecutionProfiles: {
          compact: {
            maxHistoryMessages: 800,
            maxToolIterations: 9
          }
        }
      }
    });

    expect(issues.some((i) => i.code === 'compact_history_high')).toBe(true);
    expect(issues.some((i) => i.code === 'compact_tools_high')).toBe(true);
    expect(issues.some((i) => i.code === 'context_compaction_disabled')).toBe(true);
  });
});
