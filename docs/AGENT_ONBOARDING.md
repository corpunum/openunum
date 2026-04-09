# Agent Onboarding Guide

For new OpenUnum agents joining active implementation work.

## Mandatory Read Order

1. [../BRAIN.MD](../BRAIN.MD)
2. [INDEX.md](INDEX.md)
3. [CURRENT_STATE_MATRIX.md](CURRENT_STATE_MATRIX.md)
4. [OPENUNUM_STRICT_HANDOFF_2026-04-09.md](OPENUNUM_STRICT_HANDOFF_2026-04-09.md)
5. [CODEBASE_MAP.md](CODEBASE_MAP.md)
6. [API_REFERENCE.md](API_REFERENCE.md)
7. [TESTING.md](TESTING.md)
8. [../README.md](../README.md)
9. [SKILL_BUNDLES.md](SKILL_BUNDLES.md)

## Runtime Truth First

Primary runtime state is in:
- `OPENUNUM_HOME/openunum.db` (default: `~/.openunum/openunum.db`)

Read runtime truth through API/CLI first:
- `GET /api/runtime/state-contract`
- `GET /api/runtime/config-parity`
- `node src/cli.mjs runtime status`
- `node src/cli.mjs sessions list`

Use `data/working-memory/*.json` only as optional legacy debug artifacts when present locally.

Chat runtime recovery truth:
- `POST /api/chat` may return `202` for long turns.
- `GET /api/chat/pending?sessionId=...` is canonical for completion:
  - pending: `{"ok":true,"pending":true,...}`
  - completed payload handoff: `{"ok":true,"pending":false,"completed":true,"reply":"...",...}`
  - terminal empty poll: `{"ok":true,"pending":false,...}`

## Current Provider Baseline

- `ollama-local`: local CPU lane (gemma4 + embeddings only)
- `ollama-cloud`: cloud model lane
- Additional providers: `nvidia`, `openrouter`, `xiaomimimo`, `openai`

Model-backed logical tools (phase-one substrate):
- Feature flag: `runtime.modelBackedTools.enabled`
- Controller exposure toggle: `runtime.modelBackedTools.exposeToController`
- Local guardrails: `runtime.modelBackedTools.localMaxConcurrency`, `runtime.modelBackedTools.queueDepth`
- Local rollout allowlist: `runtime.modelBackedTools.recommendedLocalModels`
- Initial logical tools: `summarize`, `classify`, `extract`, `parse_function_args`, `embed_text` (read-only, contract-validated)
- `suggest_code_patch` is intentionally gated off by default.

## Skill Bundle Authoring (Agent-Critical)

OpenUnum supports native skill bundle generation and execution:

- `skill_forge` -> generates and installs a skill bundle
- `skill_load` -> loads bundle rules into current session context
- `skill_execute` -> runs bundle `execute.mjs`

Bundle storage:

- `~/.openunum/skills/manifest.json`
- `~/.openunum/skills/custom/<skill-name>/`

When to use:

- repeated workflows/patterns, not one-off tasks
- when a reusable decision tree and examples improve consistency

Operational sequence:

1. `skill_list`
2. `skill_forge`
3. `skill_load`
4. `skill_execute`

Compact envelope is usually too restrictive for `skill_forge`; use balanced/full tier when authoring bundles.

Operational rollout APIs (WebUI Settings -> Tooling and Skills):
- `GET /api/runtime/tooling-inventory`
- `GET /api/models/local/status`
- `GET /api/models/local/recommended`
- `POST /api/models/local/download`
- `GET /api/models/local/downloads`
- `GET /api/models/local/downloads/:id`
- `POST /api/models/local/downloads/:id/cancel`

## Required Validation Gates

Minimum local trust gate:

```bash
pnpm test:unit
pnpm test:smoke
pnpm smoke:ui:noauth
pnpm test:imitation
pnpm e2e
pnpm docs:gate
pnpm docs:index:check
pnpm gate:runtime-surface-contract
pnpm gate:route-wiring
pnpm gate:ui-surface
pnpm gate:repo-hygiene
```

## Working Rules

- Do not re-plan from scratch when a strict handoff phase exists.
- Continue from the current phase in `docs/OPENUNUM_STRICT_HANDOFF_2026-04-09.md`.
- Keep docs and tests updated with every code change.
- Do not treat historical archive docs as canonical product truth.
