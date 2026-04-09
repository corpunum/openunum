# OpenUnum Strict Handoff (2026-04-09)

This document is the canonical implementation handoff for the next agent.

## Execution Updates

### 2026-04-09 (Post-phase reliability hardening)

- Search/runtime reliability framework updates:
  - model-native-first backend chain with quality-gated fallback in `web_search`
  - challenge-page / low-signal rejection before accepting backend evidence
  - domain-aware ranking synthesis with table/no-links output mode for follow-up prompts
- Failure-loop containment:
  - repair side-quest spawning now throttled (session+tool cooldown)
  - no repair side-quest spawn on `tool_circuit_open`
  - side-quest execution now applies `sideQuestMode`, `modelOverride`, and `toolsAllow`
- Chat pending completion contract closure:
  - added completed-payload handoff on `GET /api/chat/pending` (`completed: true`)
  - added chat runtime hard-timeout fallback to prevent silent long-turn stalls
- Regression coverage:
  - added `tests/phase49.chat-pending-completion-cache.e2e.mjs`
  - wired `pnpm phase49:e2e` into canonical phase battery

### 2026-04-09 (Phase 8 complete)

- Documentation surface was slimmed and split into canonical vs archived sets:
  - Added archive bucket: `docs/archive/2026-04-09-phase8-doc-slimming/`
  - Moved competitive analyses, dated council deep-dives, and superseded phase snapshots out of active path
- Canonical onboarding path rewritten:
  - `docs/INDEX.md`
  - `docs/AGENT_ONBOARDING.md`
  - `README.md` onboarding references
  - `docs/archive/README.md`
- Phase 8 validation completed:
  - `pnpm docs:index` ✅
  - `pnpm docs:index:check` ✅
  - `pnpm docs:gate` ✅

### 2026-04-09 (Phase 9 complete)

- Release-discipline gates were added without framework migration:
  - Added `scripts/lint-check.mjs`
  - Added `scripts/format-check.mjs`
  - Added `package.json` scripts:
    - `lint`
    - `format:check`
  - Updated `verify` pipeline to run `lint` + `format:check` before test batteries
- Updated operator docs for new quality gates:
  - `docs/TESTING.md`
  - `docs/CURRENT_STATE_MATRIX.md`
  - `README.md`
  - `NEXT_TASKS.md`
- Phase 9 validation completed:
  - `pnpm lint` ✅
  - `pnpm format:check` ✅
  - `pnpm test:unit` ✅
  - `pnpm smoke:ui:noauth` ✅
  - `pnpm docs:index` ✅
  - `pnpm docs:index:check` ✅
  - `pnpm docs:gate` ✅

### 2026-04-09 (Phase 6 continuation)

- Core decomposition delivered for shared helper/domain extraction:
  - Added `src/core/agent-helpers.mjs`
  - Added `src/tools/runtime-helpers.mjs`
  - Added `src/memory/store-helpers.mjs`
  - Added `src/memory/store-schema.mjs`
  - Added `src/memory/store-session-methods.mjs`
  - Added `src/memory/store-execution-methods.mjs`
  - Rewired imports in:
    - `src/core/agent.mjs`
    - `src/tools/runtime.mjs`
    - `src/memory/store.mjs`
- Current file sizes after extraction:
  - `src/core/agent.mjs`: 1665 LOC (from ~2131)
  - `src/tools/runtime.mjs`: 1283 LOC (from ~1504)
  - `src/memory/store.mjs`: 715 LOC (from ~1833)
- Validation run:
  - `pnpm test:unit` ✅
  - `pnpm smoke:ui:noauth` ✅
  - `pnpm phase42:e2e` ✅
  - `pnpm phase41:e2e` ✅ (passes standalone)
  - `pnpm phase42:e2e`..`pnpm phase48:e2e` ✅
- Contract-aligned E2E test fixes:
  - `tests/phase7.e2e.mjs` (`intervalMs: 0 -> 10`)
  - `tests/phase10.e2e.mjs` (`intervalMs: 0 -> 10`)

### 2026-04-09 (Phase 7 in progress)

- WebUI decomposition continued in `src/ui/app.js`:
  - Added `src/ui/modules/chat-render.js` (chat bubbles, live trace rendering)
  - Added `src/ui/modules/model-catalog-controller.js` (model current/catalog refresh and provider model list loading)
  - Added `src/ui/modules/missions-ui-controller.js` (mission refresh, mission actions, mission-to-chat session handoff)
  - Added `src/ui/modules/session-controller.js` (session list rendering, switch/load/reset lifecycle, delete flow)
  - Added `src/ui/modules/chat-composer-controller.js` (chat send/composer bindings, fast-ack and auto-mission routing)
  - Added `src/ui/modules/chat-pending-controller.js` (pending recovery, SSE/poll convergence, timeout/final-response reconciliation)
  - Added `src/ui/modules/chat-auto-mission.js` (autonomous `/auto` task runner and recovery loop)
  - Added `src/ui/modules/routing-ui-helpers.js` (provider selector + fallback sequence render/bind helpers)
  - Added `src/ui/modules/control-plane-controller.js` (control plane request runner and action wiring)
  - Added `src/ui/modules/operations-panel-actions.js` (browser/telegram/tool action wiring)
  - Added `src/ui/modules/provider-vault-helpers.js` (provider/service hidden rows, fallback/model helpers, add-row selectors)
  - Added `src/ui/modules/provider-vault-actions.js` (vault modal actions, provider/service save/test flows, OAuth connect/poll)
  - Added `src/ui/modules/provider-vault-renderers.js` (provider/service table rendering and row action wiring)
  - Added `src/ui/modules/settings-actions-controller.js` (runtime/model/provider/session UI action bindings)
  - Added `src/ui/modules/ui-shell-actions.js` (menu, vault modal, prompt, and toggle UI shell bindings)
  - Added `src/ui/modules/runtime-refreshers.js` (auth/runtime/provider/browser/telegram refresh workflows)
  - Added `src/ui/modules/vault-modal.js` (vault modal close helper)
  - Added `src/ui/modules/runtime-panels.js` (runtime overview, phase0 diagnostics, context/ledger, mission timeline panels)
  - Added `src/ui/modules/wire-validation.js` (post-mutation UI/backend wire validation flow)
- `src/ui/app.js` reduced from 2413 LOC to 699 LOC.
- E2E stabilization:
  - Hardened `tests/phase46.webui-mission-create-open.e2e.mjs` to wait for `#view-missions.active` and visible `#stopMission` before stop-click.
  - Fixed init-order regressions from modularization:
    - late binding for `renderProviderSelectors` initialization
    - late binding for `closeVaultModal` in `providerVaultActions` dependency injection
- Validation for this split:
  - `pnpm phase39:e2e` ✅
  - `pnpm phase44:e2e` ✅
  - `pnpm phase45:e2e` ✅
  - `pnpm phase46:e2e` ✅
  - `pnpm phase47:e2e` ✅
  - `pnpm smoke:ui:noauth` ✅
  - `pnpm test:unit` ✅

## Repository Context

- Repository root: `/home/corp-unum/openunum`
- Primary runtime entrypoints:
  - `src/server.mjs`
  - `src/cli.mjs`
  - `src/ui/index.html`
  - `src/ui/styles.css`
  - `src/ui/app.js`
- Primary architecture references:
  - `BRAIN.MD`
  - `docs/INDEX.md`
  - `docs/CODEBASE_MAP.md`
  - `docs/API_REFERENCE.md`
  - `docs/TESTING.md`
  - `docs/OPERATIONS_RUNBOOK.md`

### Read Before Editing

1. `docs/INDEX.md`
2. `BRAIN.MD`
3. `docs/CODEBASE_MAP.md`
4. `docs/API_REFERENCE.md`
5. `docs/TESTING.md`
6. `README.md`

### Design Principles From `BRAIN.MD`

These are not optional. The next agent should preserve them while implementing this plan:

- OpenUnum is a framework, not a one-off app.
- Autonomy is allowed inside safe boundaries.
- The system must remain model-agnostic.
- User interest and system integrity outrank convenience.
- Self-preservation matters: do not introduce fragile or destructive behavior.
- Recovery, rollback, and graceful degradation are first-class concerns.
- Test before deployment.
- Documentation and tests must move with code.
- The agent must read current code and modify it carefully, not rewrite blindly.

## Current Implementation Baseline

- Stack:
  - Node 22
  - pnpm
  - ESM modules
  - SQLite via `node:sqlite`
  - Playwright for browser E2E
  - Vitest for unit tests
- Main runtime areas:
  - HTTP server and routing: `src/server.mjs`, `src/server/routes/*`, `src/server/services/*`
  - Core agent/runtime logic: `src/core/*`
  - Persistence: `src/memory/store.mjs`
  - Provider/model catalog and routing: `src/providers/*`, `src/models/catalog.mjs`
  - WebUI: `src/ui/*`
- Current provider baseline:
  - `ollama-local`
  - `ollama-cloud`
  - `nvidia`
  - `openrouter`
  - `xiaomimimo`
  - `openai`

## Non-Negotiable Constraints

- Do not start with a framework migration.
- Do not start with a TypeScript migration.
- Do not introduce a React rewrite or other frontend stack rewrite.
- Do not keep duplicate runtime surfaces alive unless they are deliberately archived.
- Do not revert unrelated working tree changes.
- Do not treat docs as aspirational. Canonical docs must describe implemented behavior only.
- Preserve the provider split:
  - `ollama-local` = local CPU lane, gemma4 + embeddings only
  - `ollama-cloud` = cloud lane

## Review Findings

### P0: Repo Trust and Deployment Truth

1. Deployment/test commands are inconsistent.
   - `package.json` uses three different meanings of E2E:
     - `test:e2e` runs only `tests/e2e/*`
     - `e2e` runs a curated phase suite
     - `test:all` and `deploy:gate` depend on `test:e2e`, not on the broader `e2e`
   - Impact: passing the deployment gate does not prove the main runtime/browser phase suite is green.
   - Evidence:
     - `package.json:34`
     - `package.json:35`
     - `package.json:39`
     - `package.json:45`

2. The repository still tracks generated runtime state.
   - `.gitignore` says `data/working-memory/*.json` and `data/side-quests/*.json` are generated, but many such files are still tracked in git.
   - `data/audit-log.jsonl` is also tracked.
   - Impact: clone state is polluted by live artifacts; repo truth is mixed with machine state.
   - Evidence:
     - `.gitignore:19`
     - tracked files under `data/working-memory/*`
     - tracked files under `data/side-quests/*`

3. Canonical docs contradict actual repo state.
   - One doc says `data/audit-log.jsonl` is intentionally uncommitted, but the file is tracked.
   - Another canonical matrix still says the WebUI is “modularization in progress” and API docs contain a “planned section”.
   - Impact: the repo’s own trust documents are not fully trustworthy.
   - Evidence:
     - `docs/PHASES_COMPLETION_REPORT_2026-04-08.md:42`
     - `docs/CURRENT_STATE_MATRIX.md:8`
     - `docs/CURRENT_STATE_MATRIX.md:12`

4. Onboarding points agents to the wrong persistence surface.
   - The onboarding guide still tells agents to inspect `data/working-memory/*.json` first.
   - Actual runtime persistence is centered on `~/.openunum/openunum.db`.
   - Impact: a new agent can start from stale or irrelevant state.
   - Evidence:
     - `docs/AGENT_ONBOARDING.md:84`
     - `docs/CODEBASE_MAP.md:139`

### P0: Portability and Environment Isolation

5. Machine-specific absolute paths are embedded in runtime code.
   - OpenClaw discovery and OAuth compatibility paths are hardcoded under `/home/corp-unum/...`.
   - Impact: the code is not portable and mixes local compatibility behavior into core runtime assumptions.
   - Evidence:
     - `src/secrets/store.mjs:515`
     - `src/secrets/store.mjs:549`
     - `src/secrets/store.mjs:583`
     - `src/secrets/store.mjs:598`

6. Debug/utility scripts contain hardcoded local DB paths.
   - `scripts/get-session.mjs` opens `/home/corp-unum/openunum/openunum.db`.
   - Impact: utility tooling is misleading or broken on any other machine.
   - Evidence:
     - `scripts/get-session.mjs:1`

### P1: Architecture and Maintainability

7. Core files remain too large and multi-responsibility.
   - Largest files:
     - `src/ui/app.js` = 2413 LOC
     - `src/core/agent.mjs` = 2131 LOC
     - `src/memory/store.mjs` = 1833 LOC
     - `src/tools/runtime.mjs` = 1504 LOC
     - `src/server.mjs` = 1163 LOC
   - Impact: every change has high regression risk and weak local reasoning boundaries.

8. `src/server.mjs` is still doing too much.
   - It remains a large composition root with many imports, runtime initializers, and route wiring responsibilities.
   - Impact: hard to reason about lifecycle, dependencies, and startup responsibilities.
   - Evidence:
     - `src/server.mjs:1`

9. Config mutation logic is still hand-written and route-owned.
   - Validation is custom and large.
   - Mutation logic is still field-by-field imperative mutation.
   - Impact: contract drift, missed fields, brittle future changes.
   - Evidence:
     - `src/server/routes/config.mjs:29`
     - `src/server/routes/config.mjs:206`

10. Frontend modularization is incomplete.
   - `src/ui/modules/*` exists, but `src/ui/app.js` still owns large amounts of state, orchestration, and feature flow.
   - Impact: the UI is better than before but still centralized and fragile.
   - Evidence:
     - `src/ui/app.js:1`

11. Persistence and repository boundaries are mixed.
   - Runtime state lives in `~/.openunum/openunum.db`, but the repo also includes tracked/generated runtime JSON and audit artifacts.
   - Impact: no clean separation between product code, fixtures, and local runtime.

12. Chat runtime writes config on every completed chat.
   - `saveConfig()` is called after `agent.chat(...)` in the chat runtime service.
   - Impact: unnecessary persistence churn and unclear persistence boundaries.
   - Evidence:
     - `src/server/services/chat_runtime.mjs:25`

### P1: Testing and CI Discipline

13. CI only protects part of the actual phase suite.
   - Many `tests/phase*.e2e.mjs` files are not in CI and not part of `test:all`.
   - Impact: runtime behavior can regress without blocking merge/deploy.
   - Evidence:
     - `.github/workflows/phase-gates.yml:46`
     - `package.json:35`
     - `package.json:39`

14. Test taxonomy is unclear.
   - The repo has both `tests/e2e/*` and `tests/phase*.e2e.mjs`.
   - `docs/TESTING.md` calls the phase tests “legacy”, but they are still central to actual validation.
   - Impact: another agent cannot tell which tests are authoritative.

15. No lint/format quality gate exists.
   - No `lint`, `format`, ESLint, Prettier, Biome, or equivalent command exists in `package.json`.
   - Impact: style and low-grade correctness drift are not automatically checked.

### P2: Docs, Repo Shape, and Ops Hygiene

16. Active documentation surface is too large.
   - There are 52 top-level docs files and the canonical docs are too long.
   - Impact: onboarding cost is high and documentation authority is diluted.

17. Canonical docs still mix current state with roadmap wording.
   - “planned section”, “in progress”, and similar wording still appears in canonical docs.
   - Impact: factual docs and planning docs are not cleanly separated.

18. UI asset serving is still simplistic.
   - UI route reads files synchronously and directly from disk.
   - Impact: acceptable for local use, but not a disciplined asset pipeline.
   - Evidence:
     - `src/server/routes/ui.mjs:9`

19. Operations docs and examples are strongly tied to one local deployment shape.
   - Many docs assume `127.0.0.1:18880`, `/home/corp-unum/openunum`, or local OpenClaw paths.
   - Impact: operator docs are accurate for one machine, not for portable deployment.

## Execution Plan

Implement in the order below. Do not skip forward to refactors until the trust and portability phases are closed.

### Phase 0: Repo Trust Reset

Objective:
- Make the repository itself trustworthy and clone-clean.

Primary targets:
- `.gitignore`
- tracked files under `data/*`
- `docs/PHASES_COMPLETION_REPORT_2026-04-08.md`
- `docs/CURRENT_STATE_MATRIX.md`
- `docs/AGENT_ONBOARDING.md`

Tasks:
- Remove generated runtime files from the git index:
  - `data/working-memory/*.json`
  - `data/side-quests/*.json`
  - `data/audit-log.jsonl`
- Decide whether any tracked runtime files are real fixtures. If yes, move them to a dedicated fixtures directory.
- Update docs that claim those files are untracked or canonical runtime inputs.
- Add a repo-hygiene check that fails when generated runtime artifacts are tracked again.

Exit criteria:
- Fresh clone contains no live working-memory or side-quest state.
- Docs do not contradict git reality.
- Repo-hygiene gate exists and is documented.

Validation:
- `git ls-files data`
- `pnpm docs:gate`
- repo-hygiene gate command

### Phase 1: Canonicalize Test Truth

Objective:
- Make `test:all`, `deploy:gate`, CI, and the documented validation path mean the same thing.

Primary targets:
- `package.json`
- `.github/workflows/phase-gates.yml`
- `docs/TESTING.md`
- `docs/CURRENT_STATE_MATRIX.md`

Tasks:
- Introduce one canonical command, recommended name: `pnpm verify`.
- Make `deploy:gate` depend on `verify`, not on a narrower `test:all`.
- Decide authoritative test taxonomy:
  - Option A: promote phase tests into the canonical E2E suite
  - Option B: migrate critical phase tests into `tests/e2e/*` and retire phase scripts progressively
- Classify each phase test as one of:
  - canonical required
  - optional environment-dependent
  - archived/superseded
- Update CI so all required tests are represented there.

Exit criteria:
- `package.json`, CI, and docs describe the same validation model.
- No important runtime/browser contract is protected only by a manual side command.

Validation:
- `pnpm verify`
- CI workflow dry review

### Phase 2: Remove Machine-Specific Assumptions

Objective:
- Make OpenUnum portable across machines and environments.

Primary targets:
- `src/secrets/store.mjs`
- `scripts/get-session.mjs`
- scripts and docs containing `/home/corp-unum/...`
- docs and scripts hardcoding `127.0.0.1:18880`

Tasks:
- Replace hardcoded OpenClaw discovery paths with configurable/env-derived roots.
- Move compatibility discovery behind a small adapter layer or optional config.
- Rewrite `scripts/get-session.mjs` to resolve `OPENUNUM_HOME` or `getHomeDir()`.
- Normalize docs to describe defaults and env overrides instead of one machine path.

Exit criteria:
- No production/runtime code depends on `/home/corp-unum/...`.
- Utility scripts work outside this machine.
- Docs distinguish examples from requirements.

Validation:
- `rg '/home/corp-unum' src scripts`
- targeted smoke on auth/provider discovery

### Phase 3: Canonicalize Persistence and Onboarding

Objective:
- Make new-agent startup flow match actual runtime state.

Primary targets:
- `docs/AGENT_ONBOARDING.md`
- `docs/CODEBASE_MAP.md`
- `docs/OPERATIONS_RUNBOOK.md`
- `docs/INDEX.md`

Tasks:
- Rewrite onboarding so the first state source is the actual persistence model:
  - sessions/messages/traces in SQLite
  - runtime attachments via API
  - working-memory JSON only if it remains a real supported runtime surface
- Remove stale instructions that point agents to tracked/generated repo artifacts.
- Add a short “where truth lives” section:
  - code truth
  - runtime truth
  - test truth
  - docs truth

Exit criteria:
- A new agent can start without being pointed at stale repo data.
- Onboarding order is short, factual, and implementation-accurate.

Validation:
- docs review
- `pnpm docs:index`
- `pnpm docs:index:check`

### Phase 4: Refactor Contract and Config Handling

Objective:
- Replace ad hoc route-owned contract handling with shared schemas and apply logic.

Primary targets:
- `src/server/routes/config.mjs`
- `src/server/services/config_service.mjs`
- new shared schema module under `src/server/` or `src/core/`

Tasks:
- Introduce one schema system for request payload validation.
  - Recommended: `zod`
- Define schemas for:
  - `/api/config`
  - `/api/providers/config`
  - mission payloads
  - chat request payloads
  - auth/catalog update payloads
- Move config apply behavior into service/domain functions.
- Keep routes thin:
  - parse
  - validate
  - delegate
  - return

Exit criteria:
- Config routes no longer hand-mutate dozens of fields inline.
- Validation logic is shared and testable.

Validation:
- route unit tests
- targeted config/auth/missions E2E

### Phase 5: Decompose Backend Composition Root

Objective:
- Reduce `src/server.mjs` to composition and startup only.

Primary targets:
- `src/server.mjs`
- `src/server/services/*`
- `src/server/routes/*`

Tasks:
- Extract startup concerns into clear modules:
  - config/bootstrap
  - runtime registry/container
  - route registration
  - response rendering helpers
- Keep `server.mjs` as the minimal top-level boot file.
- Remove incidental business logic from the composition root.

Exit criteria:
- `src/server.mjs` is substantially smaller and easier to reason about.
- Service boundaries are clearer.

Validation:
- `pnpm gate:route-wiring`
- `pnpm e2e`

### Phase 6: Decompose Core Runtime Monoliths

Objective:
- Split core monoliths without behavior regression.

Primary targets:
- `src/core/agent.mjs`
- `src/memory/store.mjs`
- `src/tools/runtime.mjs`

Tasks:
- Split `agent.mjs` into focused modules:
  - fast-awareness and short-turn routing
  - provider attempt planning
  - provider turn execution
  - tool loop and trace assembly
  - completion/recovery logic
- Split `store.mjs` into:
  - schema init/migrations
  - repository modules by domain
  - search/query helpers
- Split `runtime.mjs` into:
  - tool catalog
  - permission/allowlist checks
  - execution dispatch
  - result normalization

Exit criteria:
- No single core file remains the default place for unrelated logic.
- Existing contracts and tests still pass.

Validation:
- `pnpm test:unit`
- `pnpm e2e`
- focused regression on trace and tool execution

### Phase 7: Finish Frontend Architecture

Objective:
- Make the WebUI maintainable without a framework rewrite.

Primary targets:
- `src/ui/app.js`
- `src/ui/modules/*`
- `src/ui/index.html`
- `src/ui/styles.css`

Tasks:
- Reduce `app.js` to bootstrap plus shared store orchestration.
- Move feature flow into dedicated controllers:
  - chat/session controller
  - provider-vault controller
  - model-routing controller
  - missions controller
  - control-plane controller
- Add clearer separation between:
  - API client normalization
  - state mutation
  - DOM render/update
- Remove remaining duplicated constants and view-global mutable state where possible.

Exit criteria:
- `app.js` is no longer the dominant feature brain.
- UI feature bugs can be fixed locally inside feature modules.

Validation:
- `pnpm phase39:e2e`
- `pnpm phase42:e2e`
- `pnpm phase44:e2e`
- `pnpm phase45:e2e`
- `pnpm phase46:e2e`

### Phase 8: Rebuild Docs Around Canonical Truth

Objective:
- Reduce documentation volume and separate active docs from history.

Primary targets:
- `docs/INDEX.md`
- `README.md`
- `docs/API_REFERENCE.md`
- `docs/TESTING.md`
- `docs/CODEBASE_MAP.md`
- `docs/AGENT_ONBOARDING.md`
- archive docs under `docs/archive/`

Tasks:
- Keep active docs limited to canonical current-state references.
- Move historical analysis, competitive notes, and superseded plans out of the active read path.
- Split or reduce oversized docs:
  - API reference by domain if needed
  - changelog into current vs historical, or release snapshots
- Remove “planned section” wording from canonical docs.

Exit criteria:
- A new agent/operator can onboard from a short set of current docs.
- Canonical docs describe current behavior, not mixed current/future behavior.

Validation:
- `pnpm docs:index`
- `pnpm docs:index:check`
- `pnpm docs:gate`

### Phase 9: Add Release and Quality Discipline

Objective:
- Block preventable style, portability, and repo-hygiene regressions automatically.

Primary targets:
- `package.json`
- `.github/workflows/phase-gates.yml`
- new repo policy scripts under `scripts/`

Tasks:
- Add `lint` and `format:check`.
  - Recommended: ESLint + Prettier or Biome
- Add repo policy gates for:
  - tracked generated files
  - absolute-path leaks
  - docs/runtime wording drift where practical
- Add `pnpm verify` as the canonical pre-merge and pre-deploy command.
- Make README and testing docs point to `pnpm verify`.

Exit criteria:
- Release discipline is enforced by automation, not memory.
- Another agent cannot accidentally regress hygiene without hitting a gate.

Validation:
- `pnpm verify`
- CI green on updated workflow

## Recommended Execution Order

Implement strictly in this order:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 8
10. Phase 9

## Definition Of Done

The handoff is complete only when all of the following are true:

- The repo no longer tracks generated runtime state.
- `pnpm verify` exists and is the single canonical validation command.
- CI, `deploy:gate`, and docs all point to the same validation truth.
- No production/runtime code depends on `/home/corp-unum/...`.
- Onboarding points to actual runtime truth, not stale repo artifacts.
- Canonical docs are current-state factual and shorter.
- Core monoliths are materially decomposed.
- WebUI orchestration is no longer concentrated in one oversized file.
- The next agent can begin from this document plus `docs/INDEX.md` without rediscovering repo contradictions.

## Startup Checklist For The Next Agent

1. Run `git status --short` and do not discard unrelated changes.
2. Read `docs/INDEX.md`.
3. Read `BRAIN.MD`.
4. Read this document.
5. Start at Phase 0 and do not skip ahead.
6. After each phase, update docs and tests before moving to the next one.
