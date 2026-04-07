/**
 * Role-to-Model Registry (R6)
 * Maps task roles to appropriate model tiers with allow/block lists.
 */

export const roleModelRegistry = {
  research: {
    minTier: 'balanced',
    recommended: ['ollama/qwen3.5:397b-cloud', 'nvidia/llama-3.3-nemotron-super-49b-v1'],
    blocked: ['ollama/qwen3.5:9b-64k'],
    description: 'Research tasks requiring synthesis and reasoning'
  },
  code_gen: {
    minTier: 'full',
    recommended: ['openai-codex/gpt-5.4', 'ollama/qwen3.5:397b-cloud'],
    blocked: [],
    description: 'Code generation requiring full capability'
  },
  code_review: {
    minTier: 'balanced',
    recommended: ['ollama/qwen3.5:397b-cloud', 'nvidia/llama-3.3-nemotron-super-49b-v1'],
    blocked: [],
    description: 'Code review and analysis'
  },
  file_ops: {
    minTier: 'compact',
    recommended: ['ollama/qwen3.5:9b-64k'],
    blocked: [],
    description: 'Simple file operations'
  },
  browser_automation: {
    minTier: 'balanced',
    recommended: ['ollama/qwen3.5:397b-cloud'],
    blocked: [],
    description: 'Browser automation tasks'
  },
  chat: {
    minTier: 'compact',
    recommended: ['ollama/qwen3.5:9b-64k', 'ollama/qwen3.5:397b-cloud'],
    blocked: [],
    description: 'General conversation'
  }
};

const MODEL_TIER_ORDER = ['compact', 'balanced', 'full'];

function getTierIndex(tier) {
  const idx = MODEL_TIER_ORDER.indexOf(tier);
  return idx >= 0 ? idx : 0;
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
        recommended: ['ollama/qwen3.5:9b-64k'],
        blocked: [],
        description: `Unknown role: ${role} (using defaults)`
      };
    }
    return { ...config };
  }

  /**
   * Check if a model is allowed for a given role
   * @param {string} role - Role name
   * @param {string} modelRef - Model reference (e.g., 'ollama/qwen3.5:9b-64k')
   * @returns {{allowed: boolean, reason: string}}
   */
  isModelAllowed(role, modelRef) {
    const config = this.resolve(role);
    const model = String(modelRef || '').toLowerCase();

    // Check blocked list first
    if (config.blocked.some(b => b.toLowerCase() === model)) {
      return {
        allowed: false,
        reason: `Model '${modelRef}' is blocked for role '${role}'`
      };
    }

    // Check if model meets minimum tier
    // For simplicity, we assume recommended models meet the tier requirement
    // In production, you'd have a separate tier mapping per model
    const isRecommended = config.recommended.some(r => r.toLowerCase() === model);
    if (isRecommended) {
      return {
        allowed: true,
        reason: `Model '${modelRef}' is recommended for role '${role}'`
      };
    }

    // Unknown model - allow if not blocked (permissive default)
    return {
      allowed: true,
      reason: `Model '${modelRef}' is not explicitly recommended but not blocked for role '${role}'`
    };
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
