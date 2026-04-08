# OpenUnum Phases Master Plan (2026-04-08)

This is the canonical execution roadmap for the current stabilization/hardening track.

## Status Snapshot

- Phase 0: ✅ Complete (repo trust reset: docs/tests baseline repair)
- Phase 1: ✅ Complete (control-plane origin hardening for browser mutation paths)
- Phase 2: ✅ Complete (route/module wiring cleanup + archived duplicate UI surface)
- Phase 3: ✅ Complete (config/provider/auth contract tightening and API alignment)
- Phase 4: ✅ Complete (WebUI modularization of `src/ui/app.js` into domain modules)
- Phase 5: ✅ Complete (SSE-first pending delivery + fallback tail timing instrumentation)
- Phase 6: ✅ Complete (feature-scored fast-awareness + latency budget telemetry)
- Phase 7: ✅ Complete (browser-level WebUI regression and CI promotion through phase47)
- Phase 8: ✅ Complete (docs/onboarding canonicalization + historical plan archive)
- Phase 9: ✅ Complete (operator CLI parity + richer mission/provider diagnostics)

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

Completed:
1. extracted session/provider-vault/missions/model-routing/control-plane/runtime/session-io modules
2. added modular helper unit tests for each extracted domain
3. reduced `src/ui/app.js` to orchestration-focused surface with domain modules

## Phase 5 — Real-Time Delivery

Goals:
1. Prefer SSE for pending chat state/results.
2. Keep adaptive polling only as fallback.

Completed so far:
- `/api/chat/stream` + EventSource hydration path is active
- fallback polling kept for non-SSE/error environments

Completed:
1. reduced tail-loop delay after provider completion via short recheck window
2. added pending timing instrumentation (`total`, `firstActivity`, `tail`) in live trace events

## Phase 6 — Agent Fast-Path Refinement

Goals:
1. Keep low-intent/short-turn responses fast and deterministic.
2. Avoid UI-specific behavior leakage into generic core logic.

Completed so far:
- fast-awareness routing expanded and guarded by unit tests

Completed:
1. replaced residual low-intent keyword-only checks with feature-scored heuristics and penalties
2. added per-stage/path latency budget telemetry in chat trace (`trace.latencyBudget`)

## Phase 7 — Protective Testing

Goals:
1. Catch real click-path regressions pre-merge.
2. Prevent docs/runtime drift from landing on `main`.

Completed so far:
- Playwright-backed UI interactions (`phase39`, `phase42`, `phase43`)
- CI includes unit/smoke/imitation + browser e2e gates

Completed:
1. provider-vault modal and hide/add row browser regressions (`phase44`, `phase45`)
2. mission create/load/open/stop lifecycle browser regression (`phase46`)
3. chat latency-budget trace contract regression (`phase47`)

## Phase 8 — Docs and Onboarding Cleanup

Goals:
1. Keep one canonical current-state narrative.
2. Archive stale plans/historical docs out of main onboarding path.

Completed so far:
- docs index freshness gate + generated self-reading index
- onboarding and API references aligned with active surfaces

Completed:
1. archived stale historical plan/snapshot docs under `docs/archive/2026-04-08-historical-plans/`
2. reduced `docs/INDEX.md` to canonical onboarding/runtime docs + explicit archive section
3. kept `NEXT_TASKS.md` pinned to this roadmap as canonical tracker

## Phase 9 — Operator Surfaces

Goals:
1. Keep CLI/WebUI/backend terminology and provider IDs in sync.
2. Make operator paths scriptable from CLI.

Completed so far:
- CLI operator API bridge: runtime/providers/auth/missions/sessions
- regression `phase41.cli-operator-surface.e2e.mjs`

Completed:
1. added richer CLI provider-health and mission summaries/timeline diagnostics
2. aligned README CLI examples with current mission timeline/status commands and provider split

## Execution Order

Continue in this order until closure:
1. Phase 4
2. Phase 5
3. Phase 6
4. Phase 7
5. Phase 8
6. Phase 9
