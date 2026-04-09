import { buildModelBackedToolSchemas, MODEL_BACKED_TOOL_CONTRACTS, normalizeModelBackedOutput } from './contracts.mjs';
import { resolveBackendProfiles } from './profiles.mjs';
import { ModelBackedToolsGovernor } from './governor.mjs';
import { executeModelJsonTool } from './adapters/model-json-tool.mjs';

function isLocalProvider(provider) {
  const p = String(provider || '').trim().toLowerCase();
  return p === 'ollama-local';
}

export class ModelBackedToolRegistry {
  constructor(config = {}) {
    this.config = config;
    this.enabled = config?.runtime?.modelBackedTools?.enabled === true;
    this.exposeToController = config?.runtime?.modelBackedTools?.exposeToController !== false;
    this.governor = new ModelBackedToolsGovernor(config);
  }

  isEnabled() {
    return this.enabled;
  }

  has(toolName) {
    return this.enabled && Boolean(MODEL_BACKED_TOOL_CONTRACTS[String(toolName || '').trim()]);
  }

  schemas() {
    return buildModelBackedToolSchemas({ exposeToController: this.exposeToController && this.enabled });
  }

  async execute(toolName, args = {}) {
    const name = String(toolName || '').trim();
    if (!this.has(name)) return { ok: false, error: 'model_backed_tool_not_enabled' };

    const profiles = resolveBackendProfiles(this.config, name);
    if (!profiles.length) {
      return { ok: false, error: 'backend_unavailable', details: `no backend profile configured for ${name}` };
    }

    let lastError = null;
    for (const profile of profiles) {
      const run = async () => executeModelJsonTool({
        config: this.config,
        toolName: name,
        args,
        profile
      });
      const out = isLocalProvider(profile.provider)
        ? await this.governor.runLocal(run)
        : await run();
      if (out?.ok) {
        return normalizeModelBackedOutput(name, out, profile);
      }
      lastError = out;
    }

    return {
      ok: false,
      tool: name,
      error: lastError?.error || 'backend_failed',
      details: lastError?.details || null
    };
  }
}

export function createModelBackedToolRegistry(config = {}) {
  return new ModelBackedToolRegistry(config);
}

