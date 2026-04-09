# Model-Backed Tools

## Purpose

OpenUnum supports logical tools whose backend can be a model execution path while preserving the normal controller/tool-call loop.

Current phase-one logical tools:

- `summarize`
- `classify`
- `extract`
- `parse_function_args`
- `embed_text`

These are read-only and contract-validated.

Gated (not active by default):

- `suggest_code_patch`

## Architecture

Primary modules:

- `src/tools/runtime.mjs` (stable execution surface)
- `src/tools/tool-contracts.mjs` (shared core tool schema contract source)
- `src/tools/backends/registry.mjs` (model-backed backend selection/execution)
- `src/tools/backends/contracts.mjs` (logical tool contracts and output normalization)
- `src/tools/backends/profiles.mjs` (backend profile resolution from config/defaults)
- `src/tools/backends/governor.mjs` (bounded local concurrency/queue control)

Important constraint:

- This feature does not replace or bypass the normal controller/tool-call flow.

## Runtime Configuration

Config path: `runtime.modelBackedTools`

```json
{
  "runtime": {
    "modelBackedTools": {
      "enabled": false,
      "exposeToController": true,
      "localMaxConcurrency": 1,
      "queueDepth": 8,
      "tools": {
        "summarize": { "backendProfiles": [] },
        "classify": { "backendProfiles": [] },
        "extract": { "backendProfiles": [] },
        "parse_function_args": { "backendProfiles": [] },
        "embed_text": { "backendProfiles": [] }
      }
    }
  }
}
```

`backendProfiles` entries support:

- `id`
- `type` (phase-one: `model`)
- `provider`
- `model`
- `timeoutMs`

If no profiles are configured for a tool, defaults are resolved from current provider models.

## Safety and Validation

- Preflight validation uses contract-driven schema checks.
- Output normalization enforces required output fields per logical tool contract.
- Local model-backed execution is bounded through queue/concurrency governor.
- Mutating system/file/network authority is not delegated to model-backed logical tools in phase one.

## Testing

Relevant unit tests:

- `tests/unit/model-backed-contracts.test.mjs`
- `tests/unit/model-backed-governor.test.mjs`
- `tests/unit/preflight-validator-model-backed.test.mjs`
- `tests/unit/request-contracts.test.mjs` (runtime config contract coverage)
