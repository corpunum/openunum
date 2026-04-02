# Autonomy Packs (Overlay Contract)

Autonomy Packs are overlay artifacts that let each agent/model evolve behavior without changing kernel invariants.

## Goals

1. Keep the product kernel light and stable.
2. Let each agent/model specialize strategy and workflows.
3. Preserve hot-swap onboarding by enforcing compatibility checks.

## Pack Layout

```text
.openunum/packs/<pack-id>/
  manifest.json
  prompts/
  skills/
  routes/
  tests/
```

## `manifest.json` (minimum)

```json
{
  "pack_id": "qwen-ops-v1",
  "version": "1.0.0",
  "created_by": "agent://openunum",
  "target": {
    "providers": ["ollama", "openai", "nvidia", "openrouter"],
    "models": ["*"]
  },
  "requires": {
    "capabilities_contract": "2026-04-02.webui-capabilities.v2",
    "tool_catalog_contract": "2026-04-02.tool-catalog.v1",
    "api_error_contract": "2026-04-02.api-errors.v1"
  },
  "safety": {
    "allow_destructive": true,
    "require_operation_id": true,
    "require_proof_for_done": true
  }
}
```

## Promotion Flow

1. Generate pack in staging (`.openunum/packs/<id>`).
2. Run validation tests (`tests/` inside pack + core e2e gates).
3. Enforce compatibility (`requires.*` must match server contracts).
4. Mark as active only after validation passes.
5. Keep previous active pack for fast rollback.

## Kernel Rules Packs Cannot Bypass

1. Destructive operations must keep safeguards (`force`, active-session protection).
2. Idempotent destructive operations must support `operationId`.
3. API errors must preserve contracted machine-readable fields.
4. Kernel resource schemas remain authoritative.

## Hot-Swap Onboarding Steps

1. New model/agent reads `GET /api/capabilities` and `GET /api/tools/catalog`.
2. It selects compatible pack(s) by `requires` contract versions.
3. It runs pack self-tests.
4. If tests fail, fallback to base pack.
5. If tests pass, activate pack and persist selection.
