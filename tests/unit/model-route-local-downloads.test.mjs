import { describe, expect, it, vi } from 'vitest';
import { handleModelRoute } from '../../src/server/routes/model.mjs';

function makeReq(method) {
  return { method };
}

function makeUrl(path) {
  return new URL(`http://localhost${path}`);
}

describe('model route local downloads', () => {
  it('queues allowlisted local model downloads', async () => {
    const sendJson = vi.fn();
    const parseBody = vi.fn().mockResolvedValue({ model: 'gemma4:cpu' });
    const handled = await handleModelRoute({
      req: makeReq('POST'),
      res: {},
      url: makeUrl('/api/models/local/download'),
      ctx: {
        config: { model: {} },
        agent: { getCurrentModel: vi.fn() },
        memoryStore: {},
        parseBody,
        sendJson,
        saveConfig: vi.fn(),
        buildModelCatalog: vi.fn(),
        buildLegacyProviderModels: vi.fn(),
        normalizeModelSettings: vi.fn(),
        normalizeProviderId: vi.fn((v) => String(v)),
        PROVIDER_ORDER: ['ollama-local', 'ollama-cloud'],
        localModelService: {
          enqueueDownload: vi.fn().mockReturnValue({
            ok: true,
            deduplicated: false,
            job: { id: 'job-1', model: 'gemma4:cpu', status: 'queued' }
          })
        }
      }
    });
    expect(handled).toBe(true);
    expect(sendJson).toHaveBeenCalledWith(
      {},
      202,
      expect.objectContaining({ ok: true })
    );
  });

  it('returns current download jobs list', async () => {
    const sendJson = vi.fn();
    const handled = await handleModelRoute({
      req: makeReq('GET'),
      res: {},
      url: makeUrl('/api/models/local/downloads?limit=5'),
      ctx: {
        config: { model: {} },
        agent: { getCurrentModel: vi.fn() },
        memoryStore: {},
        parseBody: vi.fn(),
        sendJson,
        saveConfig: vi.fn(),
        buildModelCatalog: vi.fn(),
        buildLegacyProviderModels: vi.fn(),
        normalizeModelSettings: vi.fn(),
        normalizeProviderId: vi.fn((v) => String(v)),
        PROVIDER_ORDER: ['ollama-local', 'ollama-cloud'],
        localModelService: {
          listDownloads: vi.fn().mockReturnValue({ ok: true, downloads: [] })
        }
      }
    });
    expect(handled).toBe(true);
    expect(sendJson).toHaveBeenCalledWith({}, 200, { ok: true, downloads: [] });
  });
});
