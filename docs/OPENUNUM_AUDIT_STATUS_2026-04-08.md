# OpenUnum Audit Status (2026-04-08)

Source baseline: `/home/corp-unum/Downloads/OPENUNUM_CONSOLIDATED_AUDIT_KNOWLEDGE.md`

## Verified Checklist

- [x] Verify canonical state path
  - `src/core/runtime-state-contract.mjs` + `GET /api/runtime/state-contract`
- [x] Verify context compiler path
  - `src/core/context-compiler.mjs`, integrated from `src/core/agent.mjs`
- [x] Verify memory/recall layers
  - `src/core/working-memory.mjs`, `src/core/memory-recall.mjs`, `src/memory/recall.mjs`
- [x] Verify side-quest mechanisms
  - `src/core/side-quest.mjs`, runtime artifact hygiene in `.gitignore`
- [x] Verify self-heal overlap
  - Canonicalized active runtime path on `src/core/self-heal-orchestrator.mjs`
  - `src/core/autonomy-master.mjs` now wired to orchestrator + canonical `AutoRecover` contracts
- [x] Verify execution-contract/proof overlap
  - `src/core/execution-contract.mjs`, `src/core/proof-scorer.mjs`
- [x] Verify docs-as-completion enforcement
  - `scripts/docs-completion-gate.mjs`, `pnpm docs:gate`
- [x] Verify 4B viability
  - `src/core/model-execution-envelope.mjs`, `src/core/config-parity-check.mjs`, `pnpm phase0:check`
- [x] Verify self-reading mechanism
  - `scripts/build-self-reading-index.mjs`, `pnpm docs:index`, `docs/SELF_READING_INDEX.md`
- [x] Verify existing wiki/docs/memory structure
  - `docs/INDEX.md`, `docs/CODEBASE_MAP.md`, `docs/AGENT_ONBOARDING.md`
- [x] Verify awareness/local-vs-external routing
  - `src/core/fast-awareness-router.mjs`, `src/tools/file-search.mjs`, `src/tools/web-search.mjs`
- [x] Audit stale analysis files/docs
- [x] Identify dead or unlinked files
- [x] Recommend cleanup
- [x] Recommend tests
- [x] Recommend minimal phased plan

## Key Findings

1. Active self-heal overlap was partially unresolved:
- Server runtime was already canonicalized through `SelfHealOrchestrator`.
- `AutonomyMaster` still used incompatible legacy self-heal contracts.
- Fix implemented: `AutonomyMaster` now uses `SelfHealOrchestrator` + `AutoRecover.recover(...)` canonical issue types.

2. A legacy autonomy surface is currently unlinked:
- `src/core/autonomy-coordinator.mjs` has no runtime imports/usages in repo code paths.
- Current references are doc-only historical mentions.

3. Multiple docs are present but not linked from `docs/INDEX.md` reading order:
- `AUTONOMY_GUIDE.md`, `CHANGELOG_POLICY.md`, `CONTEXT_ENGINEERING.md`,
  `INTERVENTION_TRACE.md`, `LOCAL_RUNTIME_VALIDATION_2026-04-01.md`,
  `MEMORY_SYSTEM.md`, `MODULAR_AGENT_ARCHITECTURE_NICE_TO_HAVE.md`,
  `ODD_DEFINITIONS.md`, `ROLE_MODEL_MAPPING.md`, `SELF_MODIFICATION_GUIDE.md`,
  `agent-onboarding.md`, `session-stuck-patterns.md`, plus individual council report files.

## Cleanup Recommendations

1. Consolidate legacy docs:
- Keep `docs/INDEX.md` + `docs/AGENT_ONBOARDING.md` + `docs/CHANGELOG_CURRENT.md` as canonical read path.
- Move unlinked historical docs to `docs/archive/` with a short archival index.

2. Resolve legacy runtime surface:
- Either wire `autonomy-coordinator.mjs` into runtime intentionally, or archive/remove it.

3. Keep one self-heal contract everywhere:
- New runtime paths should consume `SelfHealOrchestrator` and canonical issue-type mapping only.

## Test Recommendations

1. Keep mandatory gates:
- `pnpm docs:gate`
- `pnpm test:unit`
- `pnpm test:smoke`
- `pnpm test:e2e`

2. Keep non-blocking drift checks:
- `pnpm test:imitation`
- `pnpm phase0:check`

3. Add one e2e autonomy recovery assertion:
- exercise a degraded health payload and assert `AutonomyMaster` records successful orchestrator-driven recovery.

## Minimal Phased Plan (Post-Audit)

1. Phase A (Immediate):
- archive or wire unlinked `autonomy-coordinator.mjs`
- archive clearly stale/unlinked docs

2. Phase B (Stability):
- add autonomy recovery e2e test and runtime telemetry assertions

3. Phase C (Hardening):
- tighten 4B compact profile defaults and packet-size linting in CI

## Progress Update (2026-04-08, continued)

- ✅ Archived unlinked runtime surface:
  - moved `src/core/autonomy-coordinator.mjs` -> `maintenance/autonomy-coordinator.legacy.mjs`
- ✅ Archived stale/unlinked docs from active docs root:
  - `agent-onboarding.md`
  - `session-stuck-patterns.md`
  - `LOCAL_RUNTIME_VALIDATION_2026-04-01.md`
  - `MODULAR_AGENT_ARCHITECTURE_NICE_TO_HAVE.md`
- ✅ Added archive index:
  - `docs/archive/README.md`
