# Agent Onboarding Guide

For new OpenUnum agents joining active implementation work.

## Mandatory Read Order

1. `../BRAIN.MD`
2. `INDEX.md`
3. `CURRENT_STATE_MATRIX.md`
4. `ROADMAP.md`
5. `CODEBASE_MAP.md`
6. `API_REFERENCE.md`
7. `AUTONOMY_OPS.md`
8. `TESTING.md`
9. `../README.md`
10. `SKILL_BUNDLES.md`
11. `CHANGELOG_CURRENT.md`

## Runtime Truth First

Primary runtime truth is in:
- `OPENUNUM_HOME/openunum.db` (default `~/.openunum/openunum.db`)

Read runtime state through API/CLI first:
- `GET /api/runtime/state-contract`
- `GET /api/runtime/config-parity`
- `GET /api/autonomy/master/status`
- `GET /api/chat/diagnostics`
- `node src/cli.mjs runtime status`
- `node src/cli.mjs sessions list`
- `node src/cli.mjs missions list`

Working-memory anchors:
- primary generated path: `OPENUNUM_HOME/working-memory/*.json`
- repo-local `data/working-memory/*.json` is legacy fallback/debug state only

## Pending Chat Truth

Canonical long-turn flow:
- `POST /api/chat`
- `GET /api/chat/stream?sessionId=...&since=...&turnId=...`
- `GET /api/chat/pending?sessionId=...`

Interpretation:
- `pending=true` means the turn is still active
- `turnId` identifies the active turn
- `completed` in stream/pending payload is the authoritative completion handoff when present

## Current Provider Baseline

- `ollama-local`: local CPU lane (gemma4 + embeddings only)
- `ollama-cloud`: cloud model lane
- additional providers: `nvidia`, `openrouter`, `xiaomimimo`, `openai`

## Model-Backed Logical Tools

Feature flag:
- `runtime.modelBackedTools.enabled`

Current logical tool family:
- `summarize`
- `classify`
- `extract`
- `parse_function_args`
- `embed_text`

Intent:
- keep the main controller/tool-calling loop unchanged
- let selected logical tools use smaller local model backends where helpful

## Required Validation Gate

Minimum local trust gate:
```bash
pnpm test:unit
pnpm test:smoke
pnpm smoke:ui:noauth
pnpm test:imitation
pnpm e2e
pnpm docs:gate
pnpm docs:index:check
pnpm gate:route-registry-freshness
pnpm gate:api-reference-parity
pnpm gate:runtime-surface-contract
pnpm gate:route-wiring
pnpm gate:ui-surface
pnpm gate:repo-hygiene
```

## Working Rules

- Continue from `docs/ROADMAP.md`, not from archived phase docs unless explicitly requested.
- Use runtime truth before trusting historical docs or local generated artifacts.
- Keep docs and tests updated in the same patch as code.
- Prefer removing duplicate surfaces over preserving them for sentiment.

## Autonomy and Verification Systems (2026-04-16)

The following systems are now active and wired into the agent runtime:

- **Autonomy Master auto-starts** by default (`autonomyMasterAutoStart: true` in `src/config.mjs`). Sleep cycles, memory consolidation, self-heal, and self-improvement all run automatically.
- **Death-spiral detection** in `AutonomyMaster`: tracks consecutive no-progress cycles and enters degraded mode, auto-creating remediations.
- **Memory consolidation** triggers on time (24h) and count (50 memories), not just sleep cycles.
- **ODD enforcement** via `SafetyCouncil.checkODD()` → `resolveExecutionEnvelope()` → tier-based tool allowlists.
- **Independent Verifier** (`src/core/verifier.mjs`): 5-check system (tool appropriateness, output quality, goal alignment, safety compliance, context coherence). All results audit-logged.
- **Role-model escalation** (`src/core/role-model-registry.mjs` → `agent.mjs`): auto-escalates to a higher-tier model when the current model doesn't meet the role's minimum tier.
- **Freshness decay** wired into `HybridRetriever` at 30% weight (`src/memory/recall.mjs` → `applyFreshnessAndReturn()`).
- **FinalityGadget** (`src/core/finality.mjs` → `tools/runtime.mjs`): consecutive-success rule for irreversible tools.
- **Audit HMAC secret** uses 3-tier resolution: `AUDIT_HMAC_SECRET` env > `~/.openunum/audit-hmac-secret` file > insecure fallback with CRITICAL warning.
- **Legacy `selfheal.mjs`** is archived. Canonical self-heal path: `src/core/self-heal.mjs` + `src/core/self-heal-orchestrator.mjs`.
