# Autonomy and Memory

This document describes the active autonomy controls, mission semantics, chat pending contract, and canonical memory surfaces.

## 1. Autonomy Modes

Stored in `config.runtime.autonomyMode` and controlled by `POST /api/autonomy/mode`.

### `autonomy-first`
- balanced default
- moderate retry and tool-loop budget
- mission defaults: `continueUntilDone=true`, `hardStepCap=120`, `maxRetries=3`, `intervalMs=400`
- fallback routing remains available
- current cloud-primary baseline keeps `ollama-cloud/qwen3.5:397b-cloud` as the main controller unless runtime config explicitly changes it

### `compact-local`
- constrained local-first operation
- lower tool iteration budget and smaller mission hard cap
- stricter routing to the selected provider lane
- intended for compact/local execution envelopes

### `relentless`
- highest retry and mission budget
- lower inter-step interval and larger mission hard cap
- strict primary-provider routing
- use only when the task genuinely benefits from longer autonomous execution

## 2. Mission Truth Model

Mission runner lives in `src/core/missions.mjs`.

Key semantics:
- `maxSteps` is the planner-visible short loop budget
- `hardStepCap` is the true upper execution ceiling when `continueUntilDone=true`
- `effectiveStepLimit` is now surfaced in API/UI so operators can see the real bound
- `limitSource` tells whether the live ceiling came from `maxSteps` or `hardStepCap`

Guardrails:
- DONE claims still require proof-backed contract checks
- repeated no-progress turns trigger recovery hints
- repeated no-progress / repeated-reply stalls now fail early instead of only ending at hard cap
- start/schedule payloads are validated with bounded ranges:
  - `maxSteps`: `1..120`
  - `hardStepCap`: `1..300`
  - `maxRetries`: `0..20`

## 3. Chat Pending Contract

Canonical flow:
- `POST /api/chat`
- if long-running, client receives `202` with `pending=true`, `startedAt`, and `turnId`
- `GET /api/chat/stream?sessionId=...&since=...&turnId=...` is the preferred live channel
- `GET /api/chat/pending?sessionId=...` remains the completion-cache fallback

SSE payload now includes:
- `sessionId`
- `pending`
- `startedAt`
- `turnId`
- `toolRuns[]`
- `messages[]`
- `completed` payload handoff when final reply is already cached
- `done`

## 4. Canonical Memory Surfaces

Primary runtime memory lives in `OPENUNUM_HOME/openunum.db` (default `~/.openunum/openunum.db`).
Audit truth lives in `OPENUNUM_HOME/audit/audit-log.jsonl`.

Active SQLite tables/operators should care about:
- `sessions`
- `messages`
- `facts`
- `tool_runs`
- `strategy_outcomes`
- `route_lessons`
- `memory_artifacts`
- `session_compactions`
- `lunum_shadow_logs`
- `execution_state`

`messages` now stores optional Lunum sidecar columns for safe shadow-mode compression analysis:
- `lunum_code`
- `lunum_sem_json`
- `lunum_fp`
- `lunum_meta_json`

Natural language remains canonical; Lunum columns are sidecar metadata for shadow eval and future context-routing decisions.

There is no single canonical `memories` table.

## 5. Working Memory Anchor

`src/core/working-memory.mjs` remains the runtime anchor system for long-turn continuity.

Persistence location:
- primary: `OPENUNUM_HOME/working-memory/*.json`
- legacy fallback read path: repo-local `data/working-memory/*.json` when older local artifacts still exist

Treat these files as generated runtime artifacts, not canonical source of product truth.

## 6. Strategy Reuse and Route Lessons

Before each turn OpenUnum can retrieve:
- related `strategy_outcomes`
- recent `facts`
- `route_lessons` guidance for failing/reliable routes
- `memory_artifacts` and compaction artifacts when context is pressured

Operational intent:
- prefer previously reliable routes
- avoid repeatedly failing routes unchanged
- keep proofs and route lessons separate from chat prose

## 7. Completion Honesty

OpenUnum no longer treats checklist completion alone as sufficient for finalization.

`Task complete` footer now requires:
- checklist progress at 100%
- no partial/failure signals in the final answer
- no active provider-failure chain
- acceptable final-answer quality score
