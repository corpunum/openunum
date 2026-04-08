# OpenUnum Phases Master Plan (2026-04-08)

This is the canonical execution plan for the remaining multi-phase work after Phase 0 closure.

## Status Snapshot

- Phase 0: ✅ Complete (runtime contract/parity foundations + gates + UI diagnostics)
- Phase 1: 🟡 In Progress (cleanup/archive + stale-surface removal)
- Phase 2: ⏳ Planned (stability + targeted autonomy coverage)
- Phase 3: ⏳ Planned (hardening + enforcement)
- Phase 4: ⏳ Planned (consolidation and polish)

## Phase 1 — Cleanup and Canonicalization

Goals:
1. Remove stale/unlinked docs from active onboarding path.
2. Resolve dormant runtime surfaces that confuse architecture ownership.
3. Keep one canonical source per concern.

Tasks:
- [x] Move stale/unlinked docs to `docs/archive/`.
- [x] Add archive index (`docs/archive/README.md`).
- [x] Move unlinked `src/core/autonomy-coordinator.mjs` to maintenance legacy surface.
- [ ] Update docs index + audit status to reflect archived surfaces.

Exit criteria:
- no stale duplicate onboarding docs in `docs/` root
- no dormant coordinator in active runtime source tree

## Phase 2 — Stability and Verification

Goals:
1. Add targeted route/runtime tests for critical contracts.
2. Ensure diagnostics remain operator-first and low-noise.

Tasks:
- [x] Route-level runtime-state wiring unit tests.
- [ ] Add autonomy-master recovery e2e assertion.
- [ ] Add CI check for docs index freshness (`pnpm docs:index` drift).

Exit criteria:
- critical runtime contracts tested and stable
- CI catches stale machine-readable docs/index artifacts

## Phase 3 — Hardening

Goals:
1. Enforce compact/4B-safe boundaries in deployment and CI.
2. Reduce accidental architecture drift.

Tasks:
- [x] Compact-profile gate script + deploy/CI wiring.
- [ ] Add packet-size lint/check for context packet budget regressions.
- [ ] Add guardrails for adding new runtime surfaces without docs/API contracts.

Exit criteria:
- compact-sensitive changes cannot bypass readiness gates
- packet budget regressions are caught pre-merge

## Phase 4 — Consolidation and Final Audit Sweep

Goals:
1. Final consistency pass across onboarding/docs/changelog/API/testing.
2. Close audit follow-ups with explicit completion evidence.

Tasks:
- [ ] Refresh and verify all top-level docs links after archive moves.
- [ ] Re-run full gates and produce final closure report.
- [ ] Mark post-audit phases complete in `docs/OPENUNUM_AUDIT_STATUS_2026-04-08.md`.

Exit criteria:
- docs + code + tests + gates are aligned
- final closure report is present and source-linked
