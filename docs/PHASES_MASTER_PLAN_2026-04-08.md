# OpenUnum Phases Master Plan (2026-04-08)

This is the canonical execution roadmap for the current stabilization/hardening track.

## Status Snapshot

- Phase 0: ✅ Complete (repo trust reset: docs/tests baseline repair)
- Phase 1: ✅ Complete (control-plane origin hardening for browser mutation paths)
- Phase 2: ✅ Complete (route/module wiring cleanup + archived duplicate UI surface)
- Phase 3: ✅ Complete (config/provider/auth contract tightening and API alignment)
- Phase 4: 🟡 In progress (WebUI modularization of `src/ui/app.js`)
- Phase 5: 🟡 In progress (SSE-first pending delivery + polling fallback tuning)
- Phase 6: 🟡 In progress (agent fast-path de-overfit and latency routing)
- Phase 7: 🟡 In progress (browser-level WebUI regression and CI promotion)
- Phase 8: 🟡 In progress (docs/onboarding canonicalization and stale-surface archive)
- Phase 9: 🟡 In progress (operator CLI parity with runtime/provider/auth/mission APIs)

## Phase 0 — Trust Restoration

Goals:
1. Restore red tests and remove false claims from docs.
2. Publish one trustworthy state matrix across code/tests/docs/CI.

Completed:
- fixed phase6 e2e dynamic-port mismatch
- aligned docs/API claims to implemented endpoints
- published `docs/CURRENT_STATE_MATRIX.md`

## Phase 1 — Control Plane Hardening

Goals:
1. Stop wildcard browser-origin mutation access.
2. Keep local WebUI functionality intact.

Completed:
- browser-origin mutating requests restricted to same loopback origin+port
- `X-OpenUnum-Request: webui` marker required for browser mutating calls
- regression gate `tests/phase40.origin-guard.e2e.mjs`

## Phase 2 — Backend Route Canonicalization

Goals:
1. Keep one active runtime path per endpoint.
2. Archive duplicate or dormant surfaces.

Completed:
- archived preview UI runtime surface under `maintenance/ui-legacy/*`
- route wiring contract gate (`pnpm gate:route-wiring`)
- static UI asset route coverage (`phase43`)

## Phase 3 — Contract Formalization

Goals:
1. Keep provider/auth/model-routing payload behavior consistent.
2. Fail invalid wiring visibly in tests.

Completed:
- browser-level routing/auth regression (`phase42`)
- docs/API/testing references aligned with active routes

## Phase 4 — WebUI Modularization

Goals:
1. Break monolithic UI runtime into maintainable modules.
2. Keep behavior unchanged while shrinking `app.js` responsibility.

Completed so far:
- extracted `dom.js`, `http.js`, `feedback.js`, `navigation.js`, `logic.js`
- `index.html` now loads module runtime (`type="module"`)

Next:
1. extract chat/session view domain module
2. extract provider-vault and missions view domain modules
3. reduce `src/ui/app.js` to orchestration-only shell

## Phase 5 — Real-Time Delivery

Goals:
1. Prefer SSE for pending chat state/results.
2. Keep adaptive polling only as fallback.

Completed so far:
- `/api/chat/stream` + EventSource hydration path is active
- fallback polling kept for non-SSE/error environments

Next:
1. reduce tail-loop delay after provider completion
2. add timing instrumentation around pending-to-final transition

## Phase 6 — Agent Fast-Path Refinement

Goals:
1. Keep low-intent/short-turn responses fast and deterministic.
2. Avoid UI-specific behavior leakage into generic core logic.

Completed so far:
- fast-awareness routing expanded and guarded by unit tests

Next:
1. replace residual keyword-only branches with feature-driven checks
2. enforce per-stage latency budgets with telemetry

## Phase 7 — Protective Testing

Goals:
1. Catch real click-path regressions pre-merge.
2. Prevent docs/runtime drift from landing on `main`.

Completed so far:
- Playwright-backed UI interactions (`phase39`, `phase42`, `phase43`)
- CI includes unit/smoke/imitation + browser e2e gates

Next:
1. add provider-vault modal edit/save/delete matrix assertions
2. add mission detail create/open/stop lifecycle assertions

## Phase 8 — Docs and Onboarding Cleanup

Goals:
1. Keep one canonical current-state narrative.
2. Archive stale plans/historical docs out of main onboarding path.

Completed so far:
- docs index freshness gate + generated self-reading index
- onboarding and API references aligned with active surfaces

Next:
1. finish pruning stale root docs and archive leftovers
2. keep `NEXT_TASKS.md` pinned to exactly one active roadmap

## Phase 9 — Operator Surfaces

Goals:
1. Keep CLI/WebUI/backend terminology and provider IDs in sync.
2. Make operator paths scriptable from CLI.

Completed so far:
- CLI operator API bridge: runtime/providers/auth/missions/sessions
- regression `phase41.cli-operator-surface.e2e.mjs`

Next:
1. add richer CLI mission/provider diagnostics output
2. align README examples with current provider local/cloud split

## Execution Order

Continue in this order until closure:
1. Phase 4
2. Phase 5
3. Phase 6
4. Phase 7
5. Phase 8
6. Phase 9

