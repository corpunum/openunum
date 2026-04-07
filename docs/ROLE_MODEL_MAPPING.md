# Role-to-Model Mapping (R6)

## What is Role-Model Mapping?

The Role-Model Registry maps task roles (categories of work) to appropriate AI models. It ensures the right model is selected for each task type — using powerful models for complex work and lightweight models for simple operations.

## Roles & Model Mappings

| Role | Min Tier | Recommended Models | Blocked Models | Description |
|------|----------|-------------------|----------------|-------------|
| `research` | balanced | `ollama/qwen3.5:397b-cloud`, `nvidia/llama-3.3-nemotron-super-49b-v1` | `ollama/qwen3.5:9b-64k` | Research tasks requiring synthesis and reasoning |
| `code_gen` | full | `openai-codex/gpt-5.4`, `ollama/qwen3.5:397b-cloud` | — | Code generation requiring full capability |
| `code_review` | balanced | `ollama/qwen3.5:397b-cloud`, `nvidia/llama-3.3-nemotron-super-49b-v1` | — | Code review and analysis |
| `file_ops` | compact | `ollama/qwen3.5:9b-64k` | — | Simple file operations |
| `browser_automation` | balanced | `ollama/qwen3.5:397b-cloud` | — | Browser automation tasks |
| `chat` | compact | `ollama/qwen3.5:9b-64k`, `ollama/qwen3.5:397b-cloud` | — | General conversation |

### Tier Hierarchy

- **compact** — Lightweight local models (9B). Fast, cheap, sufficient for simple tasks.
- **balanced** — Mid-tier cloud models (397B, nemotron-49B). Good reasoning, reasonable cost.
- **full** — Best-in-class models (GPT-5.4, Codex). Maximum capability, higher cost.

## How It Works

1. A task type is classified (e.g., "research", "code_gen", "file_ops")
2. The `RoleModelResolver` looks up the role in the registry
3. It returns the recommended models filtered by what's currently available
4. The task planner selects the first available recommended model

## API

```javascript
import { RoleModelResolver } from '../core/role-model-registry.mjs';

const resolver = new RoleModelResolver();

// Get role config
resolver.resolve('research');
// → { minTier: 'balanced', recommended: [...], blocked: [...], description: '...' }

// Check if a model is allowed
resolver.isModelAllowed('research', 'ollama/qwen3.5:9b-64k');
// → { allowed: false, reason: "Model is blocked for role 'research'" }

// Get available recommended models
resolver.getRecommended('research', ['ollama/qwen3.5:397b-cloud', 'ollama/qwen3.5:9b-64k']);
// → ['ollama/qwen3.5:397b-cloud']
```

## REST API

### GET /api/roles
List all roles and their model mappings.

**Response:**
```json
{
  "ok": true,
  "roles": {
    "research": { "minTier": "balanced", "recommended": [...], ... },
    "code_gen": { ... },
    ...
  }
}
```

### GET /api/roles/:role
Get a specific role's configuration.

**Response:**
```json
{
  "ok": true,
  "role": "research",
  "config": { "minTier": "balanced", "recommended": [...], ... },
  "hasOverride": false
}
```

### POST /api/roles/:role/override
Override model mappings for a role at runtime.

**Request body:**
```json
{
  "recommended": ["custom-model-1", "custom-model-2"],
  "blocked": ["bad-model"],
  "minTier": "balanced"
}
```

## Integration with Task Planner

The `GoalTaskPlanner` uses `RoleModelResolver` to select models for each step:

```javascript
const planner = new GoalTaskPlanner();
const result = planner.resolveModelForTask('research', ['ollama/qwen3.5:397b-cloud', 'ollama/qwen3.5:9b-64k']);
// → { model: 'ollama/qwen3.5:397b-cloud', reason: '...', minTier: 'balanced' }
```

## Customization

To add a new role or modify mappings, edit `src/core/role-model-registry.mjs`:

```javascript
export const roleModelRegistry = {
  // ... existing roles ...
  my_new_role: {
    minTier: 'balanced',
    recommended: ['my-provider/my-model'],
    blocked: [],
    description: 'My custom task type'
  }
};
```

Runtime overrides via `POST /api/roles/:role/override` persist in memory until restart. For permanent changes, edit the registry file.
