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
- `GET /api/health`
- `GET /api/health/check`
- `GET /api/runtime/state-contract`
- `GET /api/runtime/config-parity`
- `GET /api/audit/diagnostics`
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
- current primary controller model: `ollama-cloud/qwen3.5:397b-cloud`
- current operational routing profile: `forcePrimaryProvider=true`, `fallbackEnabled=false` until extra providers are intentionally enabled
- additional providers: `nvidia`, `openrouter`, `xiaomimimo`, `openai`

## Deterministic and Fast-Path Routing

The agent uses a two-tier routing system to offload non-cognitive turns:

- **FastPathRouter (`src/core/fast-path-router.mjs`)**: Orchestrates deterministic and short-circuit replies for slash commands, support queries, status checks, and social/identity queries (e.g., "how smart are you?", "are you alive?").
- **FastAwarenessRouter (`src/core/fast-awareness-router.mjs`)**: Classifies messages to determine retrieval strategy and identifies "light-chat" or "greeting" turns that can be short-circuited before triggering expensive LLM calls.

Intent:
- Keep the main cognitive loop clean.
- Minimize token waste and latency for routine interactions.
- Maintain conversational competence without tool-overuse.

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

`pnpm smoke:ui:noauth` is self-contained by default and launches a temporary server unless you explicitly point it at an existing base URL.

## Working Rules

- Continue from `docs/ROADMAP.md`, not from archived phase docs unless explicitly requested.
- Use runtime truth before trusting historical docs or local generated artifacts.
- Keep docs and tests updated in the same patch as code.
- Prefer removing duplicate surfaces over preserving them for sentiment.

## Autonomy and Verification Systems (2026-04-17)

The following systems are now active and wired into the agent runtime:

- **Autonomy Master auto-starts** by default (`autonomyMasterAutoStart: true` in `src/config.mjs`). Sleep cycles, memory consolidation, self-heal, and self-improvement all run automatically.
- **Autonomy cycle execution is single-flight** in `AutonomyMaster`: overlapping timer/manual cycles collapse onto one in-flight run.
- **Death-spiral detection** in `AutonomyMaster`: tracks consecutive no-progress cycles, enters degraded mode, and now treats critical audit/parity/self-awareness signals as real no-progress.
- **Memory consolidation** triggers on time (24h) and count (50 memories), not just sleep cycles.
- **ODD enforcement** uses the real execution envelope. Compact-tier allowlists are read-only by default, and preflight now passes provider/model plus proposed tools.
- **Independent Verifier** (`src/core/verifier.mjs`): 5-check system (tool appropriateness, output quality, goal alignment, safety compliance, context coherence). Tool results and post-flight replies now pass through real verifier calls, with all verifier events audit-logged.
- **Role-model escalation** (`src/core/role-model-registry.mjs` → `agent.mjs`): tier checks now use inferred model tier instead of permissive allow-by-default behavior.
- **Role-model escalation availability filter**: recommended routes are now skipped when the provider is disabled, missing required auth/base URL, or otherwise not routable in the current runtime config.
- **Freshness decay** wired into `HybridRetriever` at 30% weight (`src/memory/recall.mjs` → `applyFreshnessAndReturn()`).
- **FinalityGadget** (`src/core/finality.mjs` → `tools/runtime.mjs`): stable operation keys, persisted state, and default `3` verified successes for tracked destructive/high-risk operations.
- **Audit log** now lives at `OPENUNUM_HOME/audit/audit-log.jsonl`. HMAC secret resolution remains: `AUDIT_HMAC_SECRET` env > `~/.openunum/audit-hmac-secret` file > insecure fallback with CRITICAL warning.
- **Self-awareness** returns `insufficient_evidence` instead of a false healthy score when there are no assistant turns to evaluate.
- **Health surface is bounded**: `/api/health` no longer re-enters self-heal via HTTP, and strict health status lives on `/api/health/check`.
- **Legacy `selfheal.mjs`** is archived under `maintenance/archive/legacy-core/`. Canonical self-heal path: `src/core/self-heal.mjs` + `src/core/self-heal-orchestrator.mjs`.
