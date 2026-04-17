/**
 * Role-to-Model Registry (R6)
 * Maps task roles to appropriate model tiers with allow/block lists.
 */

import { MODEL_TIER_ORDER, inferTier } from './model-execution-envelope.mjs';

export const roleModelRegistry = {
  research: {
    minTier: 'balanced',
    recommended: ['ollama-cloud/qwen3.5:397b-cloud', 'nvidia/llama-3.3-nemotron-super-49b-v1'],
    blocked: ['ollama-local/gemma4:cpu'],
    description: 'Research tasks requiring synthesis and reasoning'
  },
  code_gen: {
    minTier: 'full',
    recommended: ['ollama-cloud/qwen3.5:397b-cloud', 'openai/gpt-5.4'],
    blocked: [],
    description: 'Code generation requiring full capability'
  },
  code_review: {
    minTier: 'balanced',
    recommended: ['ollama-cloud/qwen3.5:397b-cloud', 'nvidia/llama-3.3-nemotron-super-49b-v1'],
    blocked: [],
    description: 'Code review and analysis'
  },
  file_ops: {
    minTier: 'compact',
    recommended: ['ollama-local/gemma4:cpu'],
    blocked: [],
    description: 'Simple file operations'
  },
  browser_automation: {
    minTier: 'balanced',
    recommended: ['ollama-cloud/qwen3.5:397b-cloud'],
    blocked: [],
    description: 'Browser automation tasks'
  },
  chat: {
    minTier: 'compact',
    recommended: ['ollama-local/gemma4:cpu', 'ollama-cloud/qwen3.5:397b-cloud'],
    blocked: [],
    description: 'General conversation'
  }
};

function getTierIndex(tier) {
  const idx = MODEL_TIER_ORDER.indexOf(tier);
  return idx >= 0 ? idx : 0;
}

function parseModelRef(modelRef = '') {
  const raw = String(modelRef || '').trim();
  if (!raw.includes('/')) return { provider: '', model: raw };
  const [provider, ...modelParts] = raw.split('/');
  return {
    provider: String(provider || '').trim(),
    model: modelParts.join('/').trim()
  };
}

export class RoleModelResolver {
  constructor(registry = roleModelRegistry) {
    this.registry = registry;
  }

  /**
   * Resolve role configuration
   * @param {string} role - Role name (e.g., 'research', 'code_gen')
   * @returns {{minTier: string, recommended: string[], blocked: string[], description: string}}
   */
  resolve(role) {
    const config = this.registry[role];
    if (!config) {
      // Default fallback for unknown roles
      return {
        minTier: 'compact',
        recommended: ['ollama-local/gemma4:cpu'],
        blocked: [],
        description: `Unknown role: ${role} (using defaults)`
      };
    }
    return { ...config };
  }

  /**
   * Check if a model is allowed for a given role
   * @param {string} role - Role name
   * @param {string} modelRef - Model reference (e.g., 'ollama-cloud/qwen3.5:397b-cloud')
   * @returns {{allowed: boolean, reason: string}}
   */
  isModelAllowed(role, modelRef) {
    const config = this.resolve(role);
    const normalizedRef = String(modelRef || '').trim();
    const model = normalizedRef.toLowerCase();

    // Check blocked list first
    if (config.blocked.some(b => b.toLowerCase() === model)) {
      return {
        allowed: false,
        reason: `Model '${modelRef}' is blocked for role '${role}'`
      };
    }

    const { provider, model: modelId } = parseModelRef(normalizedRef);
    const inferredTier = inferTier(provider, modelId || normalizedRef);
    const meetsMinTier = getTierIndex(inferredTier) >= getTierIndex(config.minTier);

    const isRecommended = config.recommended.some(r => r.toLowerCase() === model);
    if (isRecommended) {
      return {
        allowed: meetsMinTier,
        reason: meetsMinTier
          ? `Model '${modelRef}' is recommended for role '${role}'`
          : `Model '${modelRef}' is recommended but does not meet minimum tier '${config.minTier}'`
      };
    }

    if (!meetsMinTier) {
      return {
        allowed: false,
        reason: `Model '${modelRef}' inferred tier '${inferredTier}' is below required tier '${config.minTier}' for role '${role}'`
      };
    }

    return {
      allowed: true,
      reason: `Model '${modelRef}' inferred tier '${inferredTier}' satisfies role '${role}'`
    };
  }

  isAllowed(role, modelRef) {
    return this.isModelAllowed(role, modelRef);
  }

  /**
   * Get recommended models filtered by available models
   * @param {string} role - Role name
   * @param {string[]} availableModels - List of available model references
   * @returns {string[]} Filtered list of recommended models that are available
   */
  getRecommended(role, availableModels) {
    const config = this.resolve(role);
    const availableSet = new Set((availableModels || []).map(m => m.toLowerCase()));

    return config.recommended.filter(rec =>
      availableSet.has(rec.toLowerCase())
    );
  }

  /**
   * List all registered roles
   * @returns {string[]} Array of role names
   */
  listRoles() {
    return Object.keys(this.registry);
  }

  /**
   * Get the minimum tier required for a role
   * @param {string} role - Role name
   * @returns {string} Tier name ('compact', 'balanced', or 'full')
   */
  getMinTier(role) {
    return this.resolve(role).minTier;
  }

  /**
   * Check if a role exists in the registry
   * @param {string} role - Role name
   * @returns {boolean}
   */
  hasRole(role) {
    return Object.hasOwnProperty.call(this.registry, role);
  }
}

// Export singleton instance for convenience
export const resolver = new RoleModelResolver(roleModelRegistry);
