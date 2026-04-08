# Changelog

All notable changes to OpenUnum are documented in this file.

---

## [2.3.0] - 2026-04-08

### Added
- Final phases closure report:
  - `docs/PHASES_COMPLETION_REPORT_2026-04-08.md`
- `NEXT_TASKS.md` pointer file restored for docs index continuity.

### Changed
- Completed all post-audit phases (0-4) and marked completion in:
  - `docs/PHASES_MASTER_PLAN_2026-04-08.md`
  - `docs/OPENUNUM_AUDIT_STATUS_2026-04-08.md`
- Consolidated docs index link consistency after archive moves.

---

## [2.2.9] - 2026-04-08

### Added
- Packet budget gate for runtime/context packet envelopes:
  - `scripts/packet-budget-check.mjs`
  - `pnpm gate:packet-budget`
- Runtime surface docs-contract gate:
  - `scripts/runtime-surface-contract-gate.mjs`
  - `pnpm gate:runtime-surface-contract`

### Changed
- `deploy:gate` now includes:
  - compact-profile gate
  - packet-budget gate
  - runtime-surface-contract gate
- CI phase-gates workflow now runs packet-budget and runtime-surface-contract checks.
- Master phases plan updated with Phase 3 hardening tasks completed.

---

## [2.2.8] - 2026-04-08

### Added
- E2E recovery assertion for autonomy master cycle:
  - `tests/e2e/autonomy-master-recovery.e2e.mjs`
- Docs index freshness checker:
  - `scripts/docs-index-freshness-check.mjs`
  - npm command `pnpm docs:index:check`

### Changed
- CI phase-gates workflow now enforces docs index freshness.
- Master phases plan updated with Phase 2 stability tasks completed.

---

## [2.2.7] - 2026-04-08

### Added
- Canonical remaining phases execution plan: `docs/PHASES_MASTER_PLAN_2026-04-08.md`.
- Docs archive index: `docs/archive/README.md`.

### Changed
- Archived stale/unlinked docs out of active docs root:
  - `docs/archive/agent-onboarding.md`
  - `docs/archive/session-stuck-patterns.md`
  - `docs/archive/LOCAL_RUNTIME_VALIDATION_2026-04-01.md`
  - `docs/archive/MODULAR_AGENT_ARCHITECTURE_NICE_TO_HAVE.md`
- Archived dormant runtime surface:
  - `src/core/autonomy-coordinator.mjs` moved to `maintenance/autonomy-coordinator.legacy.mjs`.
- Updated docs index and audit status to reflect cleanup progress.

---

## [2.2.6] - 2026-04-08

### Added
- Compact-profile enforcement gate script (`scripts/compact-profile-gate.mjs`) and npm command (`pnpm gate:compact-profile`) to require `phase0:check` on compact/4B-sensitive changes.
- CI workflow gate `.github/workflows/phase-gates.yml` (docs gate, unit tests, phase0 check, compact gate).
- Unit coverage for session/mission runtime-state response wiring:
  - `tests/unit/runtime-wiring-routes.test.mjs`

### Changed
- Mission/session API runtime responses now include canonical `runtimeState` attachment (`contractVersion`, `validationOk`, `fingerprint`, `state`).
- WebUI `Operator Runtime & Tools` now includes a `Phase 0 Diagnostics` panel with live state-contract + config-parity status and manual refresh control.
- `deploy:gate` now includes compact-profile gate enforcement.

### Documentation
- Marked Phase 0 backlog complete in `docs/PHASE0_EXECUTION_PLAN.md`.
- Added Phase 0 triage workflow to `docs/OPERATIONS_RUNBOOK.md`.
- Updated `docs/API_REFERENCE.md` and `docs/TESTING.md` for runtime-state wiring and compact gate.

---

## [2.2.5] - 2026-04-08

### Fixed
- Rewired `AutonomyMaster` self-heal/recovery flow to use canonical `SelfHealOrchestrator` + `AutoRecover` contracts, replacing mismatched legacy calls that could silently skip recovery outcomes.
- Updated predictive-failure signal parsing in `AutonomyMaster` to align with orchestrator check keys (`disk`, `browser`, `provider`).

### Added
- Unit coverage for predictive recovery mapping and orchestrator-compatible disk signal parsing (`tests/unit/autonomy-master-recovery.test.mjs`).
- Curated self-reading index generation command `pnpm docs:index` with generated `docs/SELF_READING_INDEX.md`.
- Consolidated audit status report with verified checklist, stale/unlinked docs findings, and phased cleanup plan (`docs/OPENUNUM_AUDIT_STATUS_2026-04-08.md`).

### Documentation
- Updated onboarding and brain docs with self-reading index and session-imitation gate workflow.

---

## [2.2.4] - 2026-04-08

### Added
- Passphrase-backed encrypted secret storage backend in `src/secrets/store.mjs`.
- New environment controls:
  - `OPENUNUM_SECRETS_BACKEND=passphrase|plaintext`
  - `OPENUNUM_SECRETS_PASSPHRASE=<passphrase>`
- Secret-store status surfaced in auth catalog payload and WebUI provider status.
- Unit coverage for encrypted secret store behavior (`tests/unit/secret-store-encryption.test.mjs`).
- Bounded role-mode router (`src/core/role-mode-router.mjs`) integrated into agent turn directives and trace metadata.

### Security
- Secret store upgraded to `2026-04-08.secret-store.v2`.
- Encrypted backend writes `secrets.enc.json` using AES-256-GCM + scrypt and removes plaintext file after encrypted save by default.

### Testing
- Added session-imitation regression command (`pnpm test:imitation`) using real working-memory recovery patterns as non-blocking drift checks.

### Maintenance
- Ignored runtime-generated side-quest/working-memory artifacts and local model list files in `.gitignore` to reduce git worktree noise.

---

## [2.2.3] - 2026-04-08

### Added
- **Fast Awareness Router runtime path** integrated in `src/core/agent.mjs` with strategy-aware fast path, telemetry, and learning outcome hooks.
- **Deep inspect + external search tools**:
  - `src/tools/file-search.mjs` (`file_search`, `file_grep`, `file_info`)
  - `src/tools/web-search.mjs` (`web_search`, `web_fetch`)
- **Isolated smoke runner** `scripts/smoke-isolated.mjs` that self-starts a temporary OpenUnum server and validates smoke endpoints deterministically.

### Changed
- `pnpm test:smoke` now runs isolated smoke by default.
- Added `pnpm test:smoke:live` for deployment-instance smoke validation.
- `scripts/smoke-check.mjs` now supports `OPENUNUM_EXPECTED_PORT`.

### Fixed
- Corrected Fast Awareness integration bugs (trace shadowing, routed-tool key mismatch, use-before-declare in fast path).
- Fixed `file_grep` line matching reliability by removing regex global state drift.
- Fixed Brave backend request construction in `web_search` (proper query params + timeout-aware fetch).

### Governance
- Added docs-as-completion gate script (`pnpm docs:gate`) to fail code-only changes that skip documentation updates.

---

## [2.2.2] - 2026-04-08

### Added
- **Phase 0 Runtime Contract Module** — Canonical runtime-state packet creation, validation, and deterministic fingerprinting (`src/core/runtime-state-contract.mjs`)
- **Config Parity Analyzer** — Provider matrix checks + compact-profile 4B readiness checks (`src/core/config-parity-check.mjs`)
- **Phase 0 Check Script** — CLI readiness gate for runtime contract + config parity (`scripts/phase0-foundation-check.mjs`, `pnpm phase0:check`)
- **Runtime Diagnostics APIs** — Read-only endpoints for operators/UI:
  - `GET /api/runtime/state-contract`
  - `GET /api/runtime/config-parity`
- **E2E Coverage** — Runtime contract/parity endpoint validation (`tests/phase38.runtime-contract-parity.e2e.mjs`)

### Fixed
- **Smoke Provider Matrix Gate** — Updated smoke check to accept current `openai` provider mapping (with `generic` compatibility fallback) instead of requiring legacy-only `generic` key (`scripts/smoke-check.mjs`)
- **Verifier E2E Drift** — Replaced stale verifier integration test that targeted non-existent endpoints with server-backed tests for implemented verifier routes (`tests/e2e/verifier.e2e.mjs`)

### Documentation
- Updated README, API reference, testing guide, onboarding, and brain principles to include Phase 0 runtime-contract/parity surfaces and commands
- Added consolidated harvested-plan document from comparative repo review:
  - `docs/REPO_HARVEST_CONSOLIDATED_PLAN_2026-04-08.md`
  - `docs/PHASE0_EXECUTION_PLAN.md` (D1 marked complete)

---

## [2.2.1] - 2026-04-07

### Added
- **Maintenance Directory** — Centralized legacy planning and temporary logs (`maintenance/`)
- **Hardware Stabilization** — Created `qwen-stable` and `lfm-stable` CPU-only modelfiles for ROG Ally X to prevent ROCm/GPU driver crashes (`unspecified launch failure`)

### Fixed
- **Dataset Research Trigger** — Corrected regex in `extractRequirements` to properly identify high-intent dataset requests like "hugging face datasets" (`src/core/turn-recovery-summary.mjs`)
- **Root Directory Cleanup** — Moved misplaced scripts to `scripts/` and roadmap to `docs/ROADMAP.md`
- **System Stability** — Switched default model to `qwen-stable:latest` (Qwen 2.5 1.5B) to resolve chat timeouts and GPU-induced system restarts

### Changed
- **Server Modularization** — Extracted configuration and authentication logic from `src/server.mjs` into dedicated services (`src/server/services/config_service.mjs`, `src/server/services/auth_service.mjs`)
- **Test Consolidation** — Merged `test/` directory into `tests/` for better organization

---

## [2.2.0] - 2026-04-05

### Added
- **Channel-Agnostic Command System** — Slash commands work identically across WebUI, Telegram, CLI, and any future channel
- **Command Parser** — Enhanced parser with flag support (`--dry-run`, `--key=value`) (`src/core/command-parser.mjs`)
- **Command Registry** — Central routing system for all commands (`src/commands/registry.mjs`)
- **Command Loader** — Auto-registers all builtin commands at startup (`src/commands/loader.mjs`)
- **11 Builtin Commands:**
  - `/help [command]` — Show available commands or details
  - `/status` — Current model, tokens, context usage
  - `/new` — Start fresh session
  - `/compact [--dry-run]` — Trigger context compaction
  - `/memory` — Show memory artifacts and compaction status
  - `/cost` — Token/cost estimate
  - `/ledger` — Strategy/tool reliability ledger
  - `/session list|clear|delete <id>` — Session management
  - `/rule add|list|remove|active [text]` — Persistent behavioral rules (max 10 active)
  - `/knowledge add|list|search|remove [text]` — Searchable knowledge base
  - `/skill list` — Skill management
- **Rules System** — Persistent constraints injected into every session (`data/rules/*.json`)
- **Knowledge Base** — Searchable knowledge entries with BM25-style matching (`data/knowledge/*.json`)
- **API Endpoints** — `POST /api/command`, `GET /api/commands`
- **CLI Integration** — `openunum command /status` for direct command execution
- **Unit Tests** — 19 tests covering parser, registry, and all builtin commands (`tests/unit/commands.test.mjs`)
- **Documentation** — Command system section added to Agent Onboarding guide
- **Core Principles Document** — `BRAIN.MD` containing 9 essential operating principles

### Changed
- **Agent chat()** — Now routes through command registry before falling back to inline handler
- **Server startup** — Loads builtin commands at initialization
- **Research Query Detection** — Narrowed regex patterns to prevent false positives with "usable" keyword

### Architecture
- Commands are standalone modules in `src/commands/builtin/`
- Registry uses singleton pattern for global access
- Parser is channel-agnostic (no UI/channel dependencies)
- Backward compatible — existing inline slash commands still work as fallback
- Core principles enforcement integrated into agent onboarding

---

## [2.1.0] - 2026-04-05

### Added
- **Hybrid Retrieval Pipeline** — BM25 + Embeddings + Rerank (`src/memory/embeddings.mjs`, `src/memory/recall.mjs`)
- **Context Compiler** — Ordered context assembly pipeline (`src/core/context-compiler.mjs`)
- **Enriched Compaction Artifacts** — Extracts verifiedFacts, openLoops, pendingSubgoals, failuresWithReasons, producedArtifacts (`src/core/context-compact.mjs`)
- **Proof Scorer v2** — Multi-factor scoring with verification depth + claim specificity (`src/core/proof-scorer.mjs`)
- **Documentation** — Architecture, Context Engineering, Memory System, Agent Onboarding guides

### Changed
- **Proof threshold raised** — 0.5 → 0.6 for "done" status
- **Output substance threshold** — 50 → 100 chars for substantial output
- **Compaction output** — Now includes `enrichedArtifacts` object

### Improved
- **Verification depth scoring** — Detects result interpretation, git verification, test confirmation
- **Claim specificity scoring** — Rewards concrete evidence (paths, hashes, counts), penalizes vague language
- **Memory retrieval** — Dual scoring (BM25 + similarity) for better relevance

### Fixed
- **Context drift prevention** — Working memory anchor now injected every turn
- **Artifact extraction** — Now captures verified facts, open loops, pending subgoals

---

## [2.0.0] - 2026-03-31

### Added
- **Modular architecture** — Separated config, agent, health, memory, tools, UI
- **Session management** — Multi-session chat with sidebar UI
- **Context compaction** — Summarization with artifact extraction
- **Tool runtime** — Argument generation, fallback handling
- **Autonomy throttling** — Prevents runaway tool loops
- **Execution trace** — Tool usage logging and audit trail
- **Working memory anchor** — Prevents drift in weak models
- **Self-healing system** — Monitors and recovers from failures

### Changed
- **Monolithic → Modular** — Split server.mjs into separate modules
- **LocalStorage → Backend persistence** — Sessions stored in `data/sessions/*.json`

### Fixed
- **Tool execution bug** — Fixed `args is not defined` error
- **UI menu/API** — Repaired config, health, git-status, memory endpoints
- **Browser automation** — Installed Playwright binaries for CDP

---

## [0.1.0] - 2026-03-30

### Added
- **Initial release** — Basic autonomous assistant
- **Tool support** — File, git, exec, browser, memory, web_search
- **Telegram channel** — Bot integration with offset persistence
- **UI server** — Basic web interface at localhost:18881
- **Config system** — JSON-based configuration

---

## Version History Summary

| Version | Date | Key Changes |
|---------|------|-------------|
| 2.2.0 | 2026-04-05 | Channel-agnostic command system, rules, knowledge base, CLI integration |
| 2.1.0 | 2026-04-05 | Hybrid retrieval, context compiler, enriched compaction, proof scorer v2 |
| 2.0.0 | 2026-03-31 | Modular architecture, session management, self-healing |
| 0.1.0 | 2026-03-30 | Initial release |

---

## Upcoming (Unreleased)

- [ ] Real debate/council behavior for LexiHedge integration
- [ ] Stronger legacy risk controls and trade lifecycle
- [ ] RAG-only mode for >64K context
- [ ] Model behavior registry learning from execution traces
- [ ] Autosync race condition fix with manual git workflows
