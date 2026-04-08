# Changelog

All notable changes to OpenUnum are documented in this file.

---

## [2.3.33] - 2026-04-08

### Changed
- Phase 6 fast-path refinement:
  - upgraded low-intent/greeting detection in `src/core/fast-awareness-router.mjs` to feature-scored heuristics with stronger task/code penalties (reduced keyword-only behavior).
  - added trace latency budget reporting in `src/core/agent.mjs` (`trace.latencyBudget`) with per-stage and path-aware thresholds.

### Added
- Phase 7 protective regression:
  - extended `phase46.webui-mission-create-open.e2e.mjs` to assert mission stop lifecycle call path.
  - added `phase47.chat-latency-budget.e2e.mjs` to enforce latency-budget telemetry contract on `/api/chat`.
  - wired `phase47` into `pnpm e2e` and CI core e2e gate.

---

## [2.3.32] - 2026-04-08

### Changed
- Phase 5 pending-path refinement:
  - added pending transition timing instrumentation via `src/ui/modules/pending-telemetry.js`
  - `resolvePendingReply` and SSE path now emit timing summary events (`total`, `firstActivity`, `tail`) on final answer receipt.
  - tightened post-pending tail behavior with short activity rechecks before full session reload to reduce final-response lag.

### Added
- Unit coverage for pending telemetry helpers in `tests/unit/ui-pending-telemetry.test.mjs`.

---

## [2.3.31] - 2026-04-08

### Changed
- Continued WebUI modularization for model-routing/fallback logic:
  - extracted fallback sequence normalization, provider choice computation, online-model filtering, and provider-model patch builders into `src/ui/modules/model-routing.js`
  - `src/ui/app.js` now uses module helpers for fallback add/auto-fill/save routing behavior.

### Added
- Unit coverage for model-routing helpers in `tests/unit/ui-model-routing.test.mjs`.

---

## [2.3.30] - 2026-04-08

### Changed
- Continued WebUI modularization for session import/export/clone handlers:
  - extracted session I/O payload, filename, and status text builders to `src/ui/modules/session-io.js`
  - `src/ui/app.js` now uses module helpers for clear-all, export, import, and mission-clone status messages.

### Added
- Unit coverage for session I/O helpers in `tests/unit/ui-session-io.test.mjs`.

---

## [2.3.29] - 2026-04-08

### Changed
- Continued WebUI modularization for control-plane wiring:
  - extracted control-plane static action registry, payload builders, and custom-body parser to `src/ui/modules/control-plane.js`
  - `src/ui/app.js` now binds static control-plane buttons through module registry and uses shared builders for research/model-scout/task actions.

### Added
- Unit coverage for control-plane helpers in `tests/unit/ui-control-plane.test.mjs`.

---

## [2.3.28] - 2026-04-08

### Changed
- Continued WebUI modularization for runtime panel formatting:
  - extracted runtime overview text synthesis into `src/ui/modules/runtime-overview.js`
  - `src/ui/app.js` now applies module-generated runtime/git/provider/browser view fields.

### Added
- Unit coverage for runtime overview helpers in `tests/unit/ui-runtime-overview.test.mjs`.

---

## [2.3.27] - 2026-04-08

### Changed
- Continued WebUI modularization for provider action orchestration:
  - extracted provider/service payload builders and status formatters into `src/ui/modules/provider-actions.js`
  - `src/ui/app.js` provider vault action handlers now use module helpers for request shaping and response text generation.

### Added
- Unit coverage for provider action helpers in `tests/unit/ui-provider-actions.test.mjs`.

---

## [2.3.26] - 2026-04-08

### Changed
- Continued WebUI modularization for Provider Vault display helpers:
  - extracted status badge and provider/service summary builders to `src/ui/modules/provider-vault.js`
  - `src/ui/app.js` now imports module helpers instead of inline implementations.

### Added
- Unit coverage for provider-vault helpers in `tests/unit/ui-provider-vault.test.mjs`.

---

## [2.3.25] - 2026-04-08

### Changed
- Continued WebUI modularization for the missions domain:
  - extracted mission timeline view synthesis to `src/ui/modules/missions.js`
  - `src/ui/app.js` now consumes module output for mission summary/log/tools/artifacts sections.
- Fixed mission artifact click targeting in filtered timelines by preserving source artifact indices.

### Added
- Unit tests for mission timeline rendering helpers in `tests/unit/ui-missions.test.mjs`.
- New browser regression phase `phase46.webui-mission-create-open.e2e.mjs` for mission create/load/open-session flows.
- CI and `pnpm e2e` now include `phase46:e2e`.

---

## [2.3.24] - 2026-04-08

### Changed
- Continued WebUI modularization by extracting hidden-row visibility logic into `src/ui/modules/visibility.js`:
  - canonical known-row derivation
  - hidden-row normalization
  - add-row selector markup generation
- `src/ui/app.js` now consumes module helpers for Provider Vault row visibility state.

### Added
- Unit tests for visibility helpers in `tests/unit/ui-visibility.test.mjs`.

---

## [2.3.23] - 2026-04-08

### Fixed
- Provider Vault service hide/add row workflow now works reliably:
  - normalized `/api/capabilities.services` secret-key names (for example `githubtoken`) to canonical service IDs (for example `github`) via `src/ui/modules/capabilities.js`.
  - hidden-row normalization/selectors now use unioned known IDs from capabilities plus live auth catalog rows, preventing silent drops.

### Added
- Unit tests for capability service-ID normalization in `tests/unit/ui-capabilities.test.mjs`.

---

## [2.3.22] - 2026-04-08

### Added
- New browser regression phase `phase45.webui-vault-add-rows.e2e.mjs` to verify Provider Vault hide/add row controls for both providers and services.

### Changed
- CI Playwright gate now includes `phase45:e2e`.
- `pnpm e2e` chain now includes `phase45:e2e`.

---

## [2.3.21] - 2026-04-08

### Changed
- Reduced WebUI chat perceived latency on pending-capable turns:
  - replaced fixed 70s `/api/chat` request timeout with `chatFastAckTimeoutMs` in `src/ui/modules/logic.js`.
  - timeout budgets are now feature-based (message length/shape/context complexity) to switch into pending/live mode faster without keyword hardcoding.

### Added
- Unit coverage for fast-ack timeout budgeting in `tests/unit/ui-logic.test.mjs`.

---

## [2.3.20] - 2026-04-08

### Changed
- Continued WebUI modularization:
  - extracted session list rendering/sort/filter helpers into `src/ui/modules/sessions.js`
  - `src/ui/app.js` now uses `sortSessionsByRecency` and `renderSessionListView`.

### Added
- Unit coverage for session sorting/filtering helpers in `tests/unit/ui-sessions.test.mjs`.

---

## [2.3.19] - 2026-04-08

### Changed
- Continued WebUI modularization:
  - moved pending status synthesis logic from `src/ui/app.js` into `src/ui/modules/logic.js` (`buildPendingStatus`).

### Added
- Unit coverage for pending-status synthesis in `tests/unit/ui-logic.test.mjs`.

---

## [2.3.18] - 2026-04-08

### Added
- CLI operator command `providers health` (API bridge) to surface runtime provider health and availability from `/api/runtime/overview`.

### Changed
- Expanded `phase41.cli-operator-surface.e2e.mjs` to validate the new provider-health CLI surface.
- Updated README/onboarding command references for `providers health`.

---

## [2.3.17] - 2026-04-08

### Changed
- Hardened browser/CDP launch stability paths:
  - browser runtime recovery now prefers non-snap Chromium binaries before snap fallback.
  - added GPU-minimizing launch flags for debug browser recovery paths (`--disable-software-rasterizer`, `--disable-dev-shm-usage`, `--disable-features=Vulkan,UseSkiaRenderer`, `--use-gl=swiftshader`).
  - aligned phase32/phase33 CDP browser tests to the same binary preference and launch profile.

### Docs
- Expanded operations runbook incident triage with explicit power-key shutdown evidence checks and updated browser-recovery guidance.

---

## [2.3.16] - 2026-04-08

### Changed
- Pending-run reply resolver now performs an immediate first activity check before entering adaptive backoff waits.
- This removes the initial artificial wait on pending recovery and reduces short-turn response latency while preserving SSE/poll fallback behavior.

---

## [2.3.15] - 2026-04-08

### Added
- New browser regression phase: `phase44.webui-vault-mission-details.e2e.mjs`.
  - validates provider-vault modal `Test` and `Save` actions invoke backend wiring.
  - validates mission timeline filter/search rendering for log/tool detail surfaces.

### Changed
- CI Playwright WebUI gate now runs `phase39`, `phase42`, and `phase44`.
- `pnpm e2e` chain now includes `pnpm phase44:e2e`.
- Testing/onboarding/state-matrix docs updated with phase44 coverage.

---

## [2.3.14] - 2026-04-08

### Changed
- Continued WebUI modularization:
  - extracted detail-panel persistence helpers to `src/ui/modules/detail-panels.js`
  - `src/ui/app.js` now uses module-based detail state load/key/bind/persist helpers.

### Added
- New unit coverage for detail-panel persistence helpers in `tests/unit/ui-detail-panels.test.mjs`.

---

## [2.3.13] - 2026-04-08

### Changed
- Continued WebUI modularization:
  - extracted pure UI runtime logic into `src/ui/modules/logic.js`
    - pending poll delay strategy
    - relative time formatting
    - assistant-message hydration selection
    - status-check / planning classification helpers
    - provider/model formatting + prefix normalization
  - `src/ui/app.js` now imports those helpers instead of defining them inline.

### Added
- New unit coverage for extracted UI logic in `tests/unit/ui-logic.test.mjs`.

---

## [2.3.12] - 2026-04-08

### Changed
- Continued WebUI JS modularization:
  - extracted toast/status helpers to `src/ui/modules/feedback.js`
  - extracted view navigation helper to `src/ui/modules/navigation.js`
  - `src/ui/app.js` now imports these helpers to reduce monolithic utility density

---

## [2.3.11] - 2026-04-08

### Changed
- Continued WebUI modularization inside the JS runtime:
  - introduced `src/ui/modules/dom.js` for shared DOM/query/escape/sleep helpers
  - introduced `src/ui/modules/http.js` for retrying JSON API request helpers
  - `src/ui/app.js` now imports shared helpers instead of keeping all utility code inline
  - `src/ui/index.html` now loads app runtime as an ES module (`type=\"module\"`)

---

## [2.3.10] - 2026-04-08

### Changed
- Started WebUI modularization:
  - moved inline CSS from `src/ui/index.html` to `src/ui/styles.css`
  - moved inline JS from `src/ui/index.html` to `src/ui/app.js`
  - `src/server/routes/ui.mjs` now serves modular UI assets from `/ui/*`

### Added
- `phase43.ui-static-assets.e2e.mjs` regression:
  - verifies `/ui/styles.css` and `/ui/app.js` are served with correct content types
  - verifies unknown `/ui/*` assets return `404`
- CI core E2E contract set now includes `pnpm phase43:e2e`.

---

## [2.3.9] - 2026-04-08

### Added
- New browser regression phase `phase42.webui-routing-auth.e2e.mjs`:
  - validates `Model Routing` save action wiring (`POST /api/config`)
  - validates `Service Vault` modal open/save wiring (`POST /api/auth/catalog`)

### Changed
- CI WebUI Playwright gate now runs both:
  - `pnpm phase39:e2e`
  - `pnpm phase42:e2e`

---

## [2.3.8] - 2026-04-08

### Added
- CLI operator API-bridge commands in `src/cli.mjs`:
  - `runtime status`
  - `providers catalog`
  - `auth catalog`
  - `missions list|status|start|stop`
  - `sessions list|delete`
  - all remote API bridge commands use `OPENUNUM_BASE_URL` (default `http://127.0.0.1:18880`)
- New phase test: `phase41.cli-operator-surface.e2e.mjs` validating CLI operator surfaces against a live test server.
- New gate script: `scripts/ui-surface-gate.mjs` to enforce a single canonical active UI file under `src/ui/`.

### Changed
- CI `phase-gates` now includes `phase41:e2e` and `gate:ui-surface`.
- `pnpm e2e` chain now includes `pnpm phase41:e2e`.

---

## [2.3.7] - 2026-04-08

### Fixed
- Hardened browser mutating control-plane protection:
  - browser-origin mutating requests are now restricted to same loopback origin+port as the server.
  - browser-origin mutating requests now require `X-OpenUnum-Request: webui`.
  - cross-origin localhost browser mutation attempts now return `403 origin_not_allowed`.

### Added
- New regression phase test: `phase40.origin-guard.e2e.mjs` covering preflight, origin blocking, marker enforcement, and non-browser compatibility.

### Changed
- WebUI request helpers now send `X-OpenUnum-Request: webui` on non-GET JSON requests.
- CI core E2E contract set now includes `pnpm phase40:e2e`.

---

## [2.3.6] - 2026-04-08

### Changed
- Archived duplicate preview WebUI surface to keep one active frontend runtime path:
  - `src/ui/new_ui.html` -> `maintenance/ui-legacy/new_ui.html`
  - `src/ui/serve_new_ui.mjs` -> `maintenance/ui-legacy/serve_new_ui.mjs`
- Updated current-state/audit/master-plan docs to reflect archived UI surface and completed cleanup checklist.

---

## [2.3.5] - 2026-04-08

### Added
- Browser-level WebUI regression phase: `phase39:e2e` (`tests/phase39.webui-interactions.e2e.mjs`).
  - Real click-path coverage for Provider Vault modal/open-hide-add row flows.
  - Real click-path coverage for Missions create/load/stop wiring (API interception to avoid model-heavy mission execution in UI interaction tests).

### Changed
- CI phase gates now install Playwright Chromium and run `pnpm phase39:e2e`.
- `pnpm e2e` chain now includes `pnpm phase39:e2e`.
- Docs/testing/onboarding indices updated to include the new browser E2E gate and to mark `PROJECT_STATE_SNAPSHOT.md` as historical-only.

---

## [2.3.4] - 2026-04-08

### Fixed
- `web_search` no longer hard-fails when backend is `brave` and `BRAVE_API_KEY` is missing.
  - Automatically falls back to DuckDuckGo with explicit fallback metadata.
- Reduced search-turn fragility by allowing runtime `web_search` backend `auto` and `cdp`:
  - `cdp`: use connected Chrome CDP browser session for search/extraction.
  - `auto`: prefer CDP when available, otherwise fallback to DuckDuckGo.

### Changed
- Web-search tool schema now exposes `auto` and `cdp` backend options for framework-level browser-attached search routing.

---

## [2.3.3] - 2026-04-08

### Fixed
- Resolved router crash on non-greeting turns caused by partial `classificationRules` overrides (`rules.greetingKeywords is not iterable`) by deep-merging router config defaults.
- Added defensive keyword-array handling in classifier scoring to prevent runtime exceptions from malformed/partial config.

### Changed
- Reworked fast small-talk handling into a framework-level low-intent heuristic lane:
  - short utterance bounds (word/char limits),
  - task/action signal suppression,
  - code/path/noise suppression.
  This avoids brittle phrase-by-phrase hardcoding and preserves normal routing for continuation/task intents.

### Added
- Regression tests for deep-merge router config behavior and small-talk greeting classification.

---

## [2.3.2] - 2026-04-08

### Fixed
- Greeting latency path: `hello`/`hi`/`good morning` now short-circuits immediately with deterministic response (no provider wait, no tool loop, no pending timeout churn).
- Prevented auto-continue from re-triggering model/tool execution after greeting fast-path replies.
- Corrected tool result contract for file inspection tools:
  - `file_search`, `file_grep`, `file_info` now return `ok: true`.
- Repair side-quest failure detection now requires explicit failure (`ok === false` or error) to avoid false-positive repair flows from non-error tool payloads.
- Repair side-quest execution is now asynchronous and no longer blocks user turn completion.

### Added
- Unit regression coverage for greeting fast-path classification.
- Unit regression coverage for file-search tool success contract.

---

## [2.3.1] - 2026-04-08

### Fixed
- WebUI pending-reply recovery now preserves assistant HTML formatting during `/api/sessions/:id/activity` polling, preventing malformed/plain rendering until manual browser refresh.
- Pending-run UI now reduces noisy retry chatter and performs short post-pending reconciliation fetches before declaring delayed persistence.

### Added
- Toast notification system for interactive WebUI actions (provider/service vault save/test/connect/delete, routing/runtime save, session import/export, mission start/stop, browser launch/save, model switch).
- Toast behavior includes 5-second auto-close, manual `Dismiss`, and `Pin` to keep message visible.

### Changed
- Provider health/status lines still update in-place, but action outcomes now surface as popup toasts instead of only subtle bottom text.

---

## [2.3.0] - 2026-04-08

### Added
- WebUI Provider Vault popup editor (`Edit Vault`) for model providers and service providers with backend-linked save/test flows.
- Mission screen usability expansion:
  - existing mission picker (`missionPicker`)
  - load/clear mission actions
  - timeline/detail loading for existing missions.
- Provider split for Ollama:
  - `ollama-local` (local-only, filtered to gemma4 + embeddings)
  - `ollama-cloud` (cloud model catalog lane)
- Runtime/UI wire-validation hook after WebUI mutations (provider/service/routing/mission actions).

### Changed
- Removed non-gemma local Ollama models from host runtime (`qwen-stable:latest`, `qwen2.5:1.5b`).
- Provider/model stack now includes explicit `xiaomimimo` base URL/API key in config + auth catalog flows.
- Updated provider order contracts and smoke checks to the new matrix:
  - `ollama-local`, `ollama-cloud`, `nvidia`, `openrouter`, `xiaomimimo`, `openai`.
- Stabilized phase e2e port defaults (dynamic by PID) for `phase10`/`phase11`.

### Previously Added In 2.3.0
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
