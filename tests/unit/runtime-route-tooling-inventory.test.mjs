import { describe, expect, it, vi } from 'vitest';
import { handleRuntimeRoute } from '../../src/server/routes/runtime.mjs';

function makeReq(method) {
  return { method };
}

function makeUrl(path) {
  return new URL(`http://localhost${path}`);
}

describe('runtime route tooling inventory', () => {
  it('returns tools with model-backed metadata, skills, and local model status', async () => {
    const sendJson = vi.fn();
    const toolCatalog = [
      {
        name: 'summarize',
        description: 'Summarize long text',
        parameters: { type: 'object' },
        class: 'read',
        mutatesState: false,
        destructive: false,
        proofHint: 'summary'
      },
      {
        name: 'file_read',
        description: 'Read a file',
        parameters: { type: 'object' },
        class: 'read',
        mutatesState: false,
        destructive: false,
        proofHint: 'file contents'
      }
    ];
    const handled = await handleRuntimeRoute({
      req: makeReq('GET'),
      res: {},
      url: makeUrl('/api/runtime/tooling-inventory'),
      ctx: {
        config: {
          model: { provider: 'ollama-local', model: 'ollama-local/gemma4:cpu' },
          runtime: {
            modelBackedTools: {
              enabled: true,
              exposeToController: true,
              localMaxConcurrency: 1,
              queueDepth: 8,
              tools: {
                summarize: {
                  backendProfiles: [
                    { id: 'sum.local', type: 'model', provider: 'ollama-local', model: 'ollama-local/gemma4:cpu', timeoutMs: 18000 }
                  ]
                }
              }
            }
          }
        },
        agent: {
          toolRuntime: {
            toolCatalog: vi.fn().mockReturnValue(toolCatalog)
          },
          runTool: vi.fn().mockResolvedValue({
            ok: true,
            skills: [{ name: 'example-skill', approved: true, usageCount: 2 }]
          })
        },
        localModelService: {
          recommendedLocalModels: vi.fn().mockReturnValue(['gemma4:cpu', 'nomic-embed-text:latest']),
          getLocalModelStatus: vi.fn().mockResolvedValue({
            ok: true,
            baseUrl: 'http://127.0.0.1:11434',
            installedModels: ['gemma4:cpu'],
            recommended: [{ model: 'gemma4:cpu', installed: true, allowed: true }],
            downloads: { ok: true, downloads: [], queueDepth: 0, active: 0 }
          })
        },
        sendJson,
        parseBody: vi.fn(),
        saveConfig: vi.fn(),
        normalizeProviderId: vi.fn((v) => String(v)),
        behaviorOverrideKey: vi.fn(),
        buildCapabilitiesPayload: vi.fn(),
        buildRuntimeOverview: vi.fn(),
        buildRuntimeInventory: vi.fn(),
        buildRuntimeStateContractReport: vi.fn(),
        buildAutonomyInsights: vi.fn(),
        buildConfigParityReport: vi.fn(),
        TOOL_CATALOG_CONTRACT_VERSION: 'test.contract.v1'
      }
    });

    expect(handled).toBe(true);
    expect(sendJson).toHaveBeenCalledTimes(1);
    const payload = sendJson.mock.calls[0][2];
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.tools)).toBe(true);
    expect(payload.tools.find((t) => t.name === 'summarize')?.model_backed?.contract).toBe(true);
    expect(payload.tools.find((t) => t.name === 'file_read')?.model_backed?.contract).toBe(false);
    expect(payload.skills.some((row) => row.name === 'example-skill')).toBe(true);
    expect(payload.localModels?.installedModels?.includes('gemma4:cpu')).toBe(true);
  });
});
