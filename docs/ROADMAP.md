# Roadmap (Active)

This roadmap is the live remediation plan aligned with `BRAIN.MD`.

## Completed in Current Tranche

1. Mission truthfulness
- surfaced `effectiveStepLimit` and `limitSource`
- added earlier stall failure paths for no-progress / repeated-reply loops
- reduced unsafe mission payload bounds

2. Completion honesty
- per-turn checklist reset
- `Task complete` requires non-partial finalization, not checklist state alone

3. Chat delivery reliability
- `turnId` added to pending/stream flow
- stream can now hand off completed payloads directly

4. Evidence synthesis quality
- `web_fetch` now emits canonical success shape
- recovery synthesis prefers successful evidence over circuit-open noise
- strict search-window recovery can use `web_fetch.content`

5. WebUI/runtime performance
- cached git overview in runtime summary
- cached UI asset reads for active static surface

6. Memory/runtime cleanup
- working-memory anchors now prefer `OPENUNUM_HOME/working-memory`
- onboarding/docs now treat repo-local anchor files as legacy runtime artifacts

7. Autonomy hardening loop
- deterministic user-facing quality lanes expanded (review follow-up, action confirmation, session-quality review, product-improvement prompts)
- self-awareness scoring integrated into autonomy cycle
- remediation queue implemented and auto-upserted from degraded signals

8. Live reliability + watchdog
- chat diagnostics endpoint added with pending/completed timing telemetry
- pending queue watchdog integrated into autonomy status and remediation queue

9. Self-edit safety envelope
- protected path gating with elevated approval requirement
- bounded canary profile constraints
- post-change quality-drop rollback guard

10. Operator autonomy surface
- WebUI operator panel now shows self-awareness, pending queue watchdog, and remediation queue with lifecycle controls

11. Phase 4 hardening — 10 critical gaps fixed
- autonomy auto-start enabled by default (was disabled, making all autonomy inert)
- ODD enforcement wired to actual execution envelopes via `resolveExecutionEnvelope()`
- council proof scoring verified (fast-path correctly skips, tool-using queries get full scores)
- audit HMAC secret hardened with 3-tier resolution (env > file > fallback)
- freshness decay wired into HybridRetriever at 30% weight (was 0% despite documentation)
- role-model escalation wired into agent.chat() with auto-escalation on tier mismatch
- memory consolidation triggers: time-based (24h) + count-based (50) in AutonomyMaster
- independent verifier rebuilt as 5-check system (was a 49-line stub)
- FinalityGadget wired into ToolRuntime for irreversible tools (was dead code)
- death-spiral detection in AutonomyMaster with degraded mode

12. Model-aware controller bug fixes — 6 critical bugs fixed
- behavior description removed from system prompt (prevented literal interpretation by thinking-mode models)
- `ollama-cloud` added to `defaultBehaviorFor()` conditional branches (was falling through to `planner_heavy_no_exec`)
- council revision overwrite protection (empty revision no longer replaces good first-response)
- `strict-shell-cloud` turn budget increased to 180s/4 iters (was 60s/3, too tight for 397B model)
- planner misclassification fix (tool-free substantive responses no longer classified as `planner_heavy_no_exec`)
- `chatHardTimeoutMs` set to 300s (was 90s default, killing cloud-model agent turns mid-processing)

13. Stability follow-up — decomposition + council recursion guard
- task decomposition now emits concrete steps for game/build prompts and avoids weak generic `Execute: <verb>` decomposition on broad low-signal verb lists
- completion-checklist fallback now uses actionable mapped steps (no generic verb echo)
- council postflight now skips recursive revision on mild proof-score deficits when tool/verifier evidence already exists
- regression coverage added for decomposition quality and council mild-deficit skip behavior

## Next Priority Tranche

1. Deeper frontend split
- continue breaking large settings/runtime controllers into state, API, renderer, and modal layers
- keep all mutation flows covered by browser-level tests

2. Memory unification follow-through
- continue shrinking legacy file-based memory narratives from docs and code comments
- keep SQLite surfaces as the only product-truth narrative

3. Duplicate-surface retirement
- continue deprecating legacy compatibility modules once no active runtime/import path depends on them
- keep archive docs out of onboarding flow

4. Autonomy ops consolidation
- keep `AUTONOMY_OPS.md`, API references, and operator UI controls in strict parity
- add remediation queue history/filters and canary evidence drill-down

5. Regression expansion
- turn more real bad sessions into stable imitation/browser regressions
- keep `pnpm verify` blocking on route/docs/runtime parity

## Execution Rule

No new product surface should be added ahead of:
- truthful runtime state
- bounded autonomy
- wire-verified UI/backend behavior
- docs/tests updated in the same change
