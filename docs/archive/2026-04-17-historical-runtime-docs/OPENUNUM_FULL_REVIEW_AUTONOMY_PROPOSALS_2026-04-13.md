# OPENUNUM Full Review + Autonomous Self-Awareness Proposals (2026-04-13)

## Scope
Full review across runtime behavior, chat/session quality, autonomy loops, memory, frontend/backend wiring, tests/CI, and docs/onboarding.

## Current High-Impact Findings

1. Chat quality still risks drift on open-ended product prompts.
- Evidence: Telegram-style turns like `What we can improve in for openunum ?` previously fell into tool-summary/recovery paths.
- Risk: generic/non-user-facing answers, trust erosion.

2. Autonomy has monitoring and nudges, but limited closed-loop self-development execution.
- Evidence: health checks, predictive failure, auto-improve, and nudges exist; however, no strict remediation queue that always links issue -> patch/test/canary/rollback artifacts.
- Risk: repeated failure patterns can be observed but not consistently eliminated.

3. Runtime truth surfaces are strong but still spread across many docs/files.
- Evidence: canonical docs exist, but operator onboarding still requires reading many files to understand active behavior.
- Risk: implementation and docs drift over time.

4. CI is broad and heavy, but fast quality sentinels for channel regressions should stay first-class.
- Evidence: `pnpm verify` is comprehensive; Telegram regressions now exist but should remain mandatory on every runtime-router change.
- Risk: regressions can reappear between broad merges if deterministic-channel checks are skipped.

5. Live service behavior can diverge from isolated test server runs.
- Evidence: isolated tests pass; some live `/api/chat` calls timed out while `/health` stayed healthy.
- Risk: queue/pending behavior can mask regressions not seen in isolated E2E.

## What Was Implemented In This Pass

1. Deterministic product-improvement lane.
- Added deterministic replies for prompts like `What we can improve in for openunum ? What do you think ?`.
- Added deterministic follow-up handling for loose continuations (`So ... ?`).
- Files:
  - `src/core/agent-helpers.mjs`
  - `src/core/agent.mjs`

2. Repo-inspection scope guard.
- Deterministic repo inspection now excludes broad brainstorming prompts unless explicit evidence-review intent is present.
- File:
  - `src/core/deterministic-repo-inspector.mjs`

3. Autonomy self-awareness baseline.
- Added `src/core/self-awareness.mjs` to score recent response quality using concrete leakage signals (`Status: ok/Findings`, generic acknowledgements).
- Wired snapshot into autonomy cycle + status persistence.
- Added quality drift nudge when score drops below threshold.
- Files:
  - `src/core/self-awareness.mjs`
  - `src/core/autonomy-master.mjs`
  - `src/core/autonomy-nudges.mjs`

4. Regression coverage.
- Unit tests for deterministic review follow-ups, improvement proposals, repo-inspection classification, and self-awareness scoring.
- Telegram imitation E2E expanded to include improvement prompt + follow-up.
- Files:
  - `tests/unit/deterministic-review-followup.test.mjs`
  - `tests/unit/deterministic-repo-inspector.test.mjs`
  - `tests/unit/self-awareness.test.mjs`
  - `tests/phase51.telegram-imitation-regression.e2e.mjs`

5. Changelog updated.
- File:
  - `docs/CHANGELOG_CURRENT.md`

6. Phase B foundation (autonomous remediation queue) implemented.
- Added persistent remediation queue core and AutonomyMaster wiring.
- Added remediation lifecycle APIs and E2E coverage (`phase52`).
- Automatic queue upsert now happens when self-awareness score is degraded.

7. Phase D foundation (live chat diagnostics + queue watchdog) implemented.
- Added `/api/chat/diagnostics` with pending/completed timing telemetry.
- Added timeout metadata to pending chat responses (`ageMs`, `hardTimeoutMs`, `timeoutHeadroomMs`).
- Added pending-queue watchdog diagnostics in AutonomyMaster status plus queue-stall remediation upsert.
- Added regression coverage (`tests/unit/chat-runtime-diagnostics.test.mjs`, `tests/phase53.chat-diagnostics-watchdog.e2e.mjs`).

8. Phase C foundation (self-edit safety envelope) implemented.
- Added protected-path gating for critical runtime/governance files in self-edit pipeline (requires explicit elevated approval payload).
- Added bounded self-edit canary profile constraints and post-change quality-drop rollback guard.
- Added regression coverage (`tests/unit/self-edit-pipeline-hardening.test.mjs`, `tests/phase54.self-edit-safety-envelope.e2e.mjs`).

9. Phase E foundation (operator autonomy dashboard) implemented.
- Added operator-facing autonomy dashboard section in WebUI (`view-operator`) for self-awareness, pending queue watchdog, and remediation queue.
- Added remediation lifecycle controls in WebUI (sync/start/resolve/fail/cancel).
- Added browser-level regression coverage (`tests/phase55.webui-autonomy-dashboard.e2e.mjs`).

## Proposed Execution Plan (Strict, Phase-Based)

### Phase A — Channel Truthfulness Hardening (Immediate)
Goal: user-facing responses never degrade into recovery/tool formatting for normal conversational turns.

Tasks:
1. Add deterministic lane for `quality review` + `product improvement` + `action confirmation` + `review follow-up` as a maintained policy set.
2. Extend channel regression corpus from Telegram into WebUI and CLI conversation traces.
3. Add a policy test that fails on forbidden output shapes (`Status: ok/Findings`) unless explicitly requested.

Exit Criteria:
- 0 forbidden-shape leaks across channel imitation suites.
- `phase51` + new WebUI/CLI imitation suites green.

### Phase B — Autonomous Remediation Queue
Goal: convert self-awareness and health signals into bounded executable improvement tasks.

Tasks:
1. Create an `autonomy remediation queue` store (`issue -> plan -> patch -> test -> canary -> promote/rollback`).
2. Require acceptance checks before state transitions.
3. Persist immutable audit references for each transition.

Exit Criteria:
- Every `degraded` self-awareness event creates/updates a remediation item.
- No remediation item can be marked complete without tests + canary evidence.

### Phase C — Self-Development Safety Envelope
Goal: allow self-improvement without risking runtime destabilization.

Tasks:
1. Add canary execution profiles for self-edits (limited tools, short timeouts, strict rollback).
2. Add automatic rollback when post-change quality score drops.
3. Add protected paths policy (core safety/auth/audit files require elevated approval path).

Exit Criteria:
- Canary failures auto-rollback with audit proof.
- Protected-path violations are blocked by policy tests.

### Phase D — Live Runtime Reliability
Goal: eliminate divergence between isolated tests and live service behavior.

Tasks:
1. Add live-service pending/queue watchdog diagnostics.
2. Add `/api/chat` timeout telemetry breakdown (queue wait, router, provider, persistence).
3. Add live-smoke check for deterministic fast lanes.

Exit Criteria:
- Live service diagnostics identify timeout bottlenecks.
- Deterministic lanes stay <1s in live smoke for short prompts.

### Phase E — Frontend/Operator Surfaces
Goal: expose autonomy state and controls in a single operator-visible pane.

Tasks:
1. Add self-awareness panel in WebUI runtime/autonomy area (score, issues, nudges, active remediations).
2. Add remediation queue controls (create/run/abort/promote/rollback).
3. Add clear status badges for deterministic lane health and channel quality.

Exit Criteria:
- Operator can see and act on self-awareness and remediation state without reading logs.

### Phase F — Docs/Onboarding Compression
Goal: reduce onboarding ambiguity and keep one canonical operational path.

Tasks:
1. Create one canonical `Autonomy Ops` doc for cycle, self-awareness, remediation queue, and rollback.
2. Keep `README`, `INDEX`, `AGENT_ONBOARDING`, and API docs synchronized by parity checks.
3. Archive superseded operational notes.

Exit Criteria:
- New agent can execute full autonomy workflow from canonical docs only.
- Docs parity gate passes after each autonomy/router change.

## Operational Metrics (Must Track)

1. `self_awareness_score` (target >= 85 steady state)
2. `recovery_format_leak_rate` (target 0 for normal user-facing turns)
3. `generic_ack_leak_rate` (target < 1%)
4. `autonomy_remediation_cycle_time` (issue detected -> verified fix)
5. `post-change_regression_rate` (target downward trend)

## Recommended Next Implementation Order

1. Phase B (Autonomous Remediation Queue)
2. Phase D (Live Runtime Reliability)
3. Phase C (Self-Development Safety Envelope)
4. Phase E (Operator Surface)
5. Phase F (Docs/Onboarding Compression)

Reason: detection already improved; the next bottleneck is reliable autonomous execution of fixes with safety and verifiability.
