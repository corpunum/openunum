# OpenUnum

OpenUnum is an Ubuntu-first autonomous agent framework built around the principles in `BRAIN.MD`: framework orientation, bounded autonomy, model agnosticism, truthful completion, continuous validation, and self-improvement through memory.

## Current State (2026-04-17)

Implemented and active:
- modular WebUI backed by the active server/runtime routes
- multi-provider runtime with explicit `ollama-local` and `ollama-cloud` lanes
- current cloud-primary controller baseline: `ollama-cloud/qwen3.5:397b-cloud`
- chat trace visibility, pending SSE updates, and completion-cache handoff
- mission runner with proof-aware completion, effective step-limit reporting, and stall guardrails
- SQLite-backed runtime memory (`facts`, `tool_runs`, `strategy_outcomes`, `route_lessons`, `memory_artifacts`, `session_compactions`)
- model-backed logical tools and native skill-bundle lifecycle
- route-registry and API-reference parity gates in `pnpm verify`

Recent hardening in this tranche:
- council revision overwrite protection: revision turns that return empty no longer replace good first-response text
- behavior description removed from controller system prompt to prevent literal interpretation by thinking-mode models
- `ollama-cloud` now correctly resolves to `timeout_prone_deep_thinker` instead of falling through to `planner_heavy_no_exec`
- turn budget for `strict-shell-cloud` profile increased to 180s/4 iterations (was 60s/3)
- planner misclassification fix: tool-free substantive responses no longer classified as `planner_heavy_no_exec`
- chat hard timeout increased to 300s (was 90s default) to support multi-iteration cloud-model agent turns
- per-turn completion checklist reset to prevent cross-turn false completion state
- `Task complete` footer now requires both 100% checklist progress and a non-partial final answer
- mission UI/API now expose `effectiveStepLimit` and whether it came from `maxSteps` or `hardStepCap`
- mission loops fail earlier on repeated no-progress/repeated-reply stalls instead of burning to hard cap
- `/api/chat/stream` now includes `turnId` and completion payload handoff for more reliable pending resolution
- `web_fetch` now returns canonical success shape (`ok: true`) and recovery synthesis now prefers successful evidence over circuit-open noise
- runtime overview and UI asset serving now cache low-volatility reads to reduce WebUI overhead
- working-memory anchors now prefer `OPENUNUM_HOME/working-memory` over repo-local generated state
- config parity now fails impossible provider states such as disabled active primary + forced-primary routing
- compact execution envelopes are read-only by default; mutating tools are no longer in the compact allowlist
- audit log storage now lives under `OPENUNUM_HOME/audit/audit-log.jsonl`
- independent verification now runs on tool results and post-flight replies
- finality tracking uses stable operation keys, default `3` verified successes, and persisted state
- autonomy cycles now run single-flight and degrade on critical health/audit/parity/self-awareness signals
- `/api/health` and autonomy health checks are now bounded and non-recursive
- role-model escalation now skips disabled/unconfigured provider routes instead of escalating into dead lanes
- legacy `selfheal.mjs` / `health-monitor.mjs` are archived out of `src/`

## Fast Start

1. Install dependencies:
```bash
pnpm install
```

2. Start the server:
```bash
node src/server.mjs
```

3. Open the WebUI:
- `http://127.0.0.1:18880`

## Canonical Validation

Minimum trust gate before merge/deploy:
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

Canonical umbrella gate:
```bash
pnpm verify
```

`pnpm smoke:ui:noauth` starts an isolated temporary server unless `OPENUNUM_BASE_URL` or `OPENUNUM_API_URL` is explicitly set.

## New-Agent Read Order

1. `BRAIN.MD`
2. `docs/INDEX.md`
3. `docs/CURRENT_STATE_MATRIX.md`
4. `docs/ROADMAP.md`
5. `docs/AGENT_ONBOARDING.md`
6. `docs/CODEBASE_MAP.md`
7. `docs/API_REFERENCE.md`
8. `docs/AUTONOMY_AND_MEMORY.md`
9. `docs/AUTONOMY_OPS.md`
10. `docs/TESTING.md`
11. `docs/CHANGELOG_CURRENT.md`

## Common Commands

```bash
pnpm start
pnpm verify
pnpm e2e
pnpm test:unit
pnpm test:smoke
pnpm smoke:ui:noauth
pnpm test:imitation
node src/cli.mjs health
node src/cli.mjs status
node src/cli.mjs runtime status
node src/cli.mjs chat --message "hello"
node src/cli.mjs model switch --provider ollama-cloud --model ollama-cloud/qwen3.5:397b-cloud
node src/cli.mjs missions list
node src/cli.mjs missions status --id <missionId>
node src/cli.mjs sessions list
```

## Runtime Notes

- Default autonomy preset is `autonomy-first`.
- Default cloud-primary model is `ollama-cloud/qwen3.5:397b-cloud`.
- Operational routing baseline is cloud-primary with controlled fallback enabled (`forcePrimaryProvider=false`, `fallbackEnabled=true`) so long turns can recover when the primary route degrades.
- Other supported presets are `compact-local` and `relentless`.
- Mission payloads are now guarded: `maxSteps` is bounded to `1..120`, `hardStepCap` to `1..300`, and `maxRetries` to `0..20`.
- Working-memory anchors are generated runtime artifacts, not canonical repo inputs.
- Audit truth lives at `OPENUNUM_HOME/audit/audit-log.jsonl`, not repo-root generated data.
- `GET /api/config` is sanitized. Use `GET /api/providers/config` and `GET /api/auth/catalog` for provider/auth readiness.
- Live autonomy/operator telemetry surfaces:
  - `GET /api/autonomy/master/status`
  - `GET /api/autonomy/remediations`
  - `GET /api/chat/diagnostics`
  - `GET /api/audit/diagnostics`

## Deployment

- service file: `deploy/openunum.service`
- installer: `scripts/install-systemd.sh` (installs `openunum.service` and the scheduled `openunum-autonomy-cycle.timer`)
- base URL for CLI remote bridge: `OPENUNUM_BASE_URL` (default `http://127.0.0.1:18880`)
