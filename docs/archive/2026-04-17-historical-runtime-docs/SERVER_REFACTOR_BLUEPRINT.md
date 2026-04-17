# Server Refactor Blueprint

Date: 2026-04-03
Owner: OpenUnum
Primary target: `src/server.mjs` (currently ~2311 LOC)

## Goals

1. Split `src/server.mjs` into domain route modules without changing API behavior.
2. Keep endpoint contracts stable while increasing maintainability.
3. Make background loops/services explicit and testable.
4. Reduce security risk by centralizing shell/command execution controls.

## Current-State Findings (Verified)

- Monolithic server entrypoint: `src/server.mjs` (~2311 lines).
- Raw Node HTTP handling with in-file route branching.
- Overlapping self-heal modules exist: `src/core/self-heal.mjs` and `src/core/selfheal.mjs`.
- Multiple hardcoded references to `src/ui/index.html` and UI-specific hotfix logic in agent core.
- Many `execSync` / `spawn` call sites across server/core paths.

## Target Architecture

```
src/
  server/
    app.mjs
    context.mjs
    http/
      json.mjs
      errors.mjs
      request.mjs
      response.mjs
    services/
      auth-jobs.mjs
      browser-runtime.mjs
      telegram-runtime.mjs
      research-runtime.mjs
    routes/
      health.mjs
      capabilities.mjs
      config.mjs
      model.mjs
      auth.mjs
      sessions.mjs
      missions.mjs
      browser.mjs
      telegram.mjs
      autonomy.mjs
      research.mjs
      skills.mjs
      tools.mjs
      ui.mjs
```

## Context Object Contract

All route handlers receive a single immutable context:

- `config`, `saveConfig`
- `memory`, `agent`, `missions`, `browser`
- `autonomyMaster`, `selfHealMonitor`
- `pendingChats`, `authJobs`
- helper APIs (build catalog/runtime payloads, provider/service tests)

This removes hidden coupling and allows route-level unit tests.

## Route Ownership Map

- `health.mjs`: `/health`, `/api/health`, `/api/health/check`, self-heal status/run/fix aliases.
- `capabilities.mjs`: `/api/capabilities`, `/api/tools/catalog`, runtime overview/insights.
- `config.mjs`: `/api/config`, `/api/providers/config`, provider imports.
- `model.mjs`: `/api/model/current`, `/api/model/switch`, `/api/models`, `/api/model-catalog`.
- `auth.mjs`: `/api/auth/catalog`, `/api/auth/prefill-local`, `/api/provider/test`, `/api/service/test`, OAuth jobs.
- `sessions.mjs`: list/create/import/clone/delete/clear/export/activity/get.
- `missions.mjs`: list/status/timeline/start/stop.
- `browser.mjs`: status/config/navigate/search/extract/launch.
- `telegram.mjs`: config/status/start/stop.
- `autonomy.mjs`: mode + autonomy master lifecycle endpoints.
- `research.mjs`: run/recent/queue/approve.
- `skills.mjs`: list/install/review/approve/execute/uninstall.
- `tools.mjs`: `/api/tool/run`, email + gworkspace call endpoints.
- `ui.mjs`: `/`, `/index.html` static HTML serving.

## HTTP Utility Layer

Create shared helpers:

- `parseJsonBody(req)`
- `sendJson(res, status, payload)`
- `sendApiError(res, status, code, message, extra)`
- `noCacheHeaders(contentType)`
- method/path matchers

This eliminates repeated boilerplate and ensures contract consistency.

## Security Hardening Plan

1. Introduce `command-runner.mjs` with explicit allowlist + argument schema.
2. Replace direct `execSync`/`spawn` calls in routes with command-runner wrappers.
3. Preserve current behavior, but enforce:
   - no shell interpolation for user-controlled strings
   - explicit timeout defaults
   - structured error payloads (`error_code`, `detail`, `stderr_excerpt`)

## Self-Heal Consolidation Plan

Current overlap:

- `SelfHealSystem` (`self-heal.mjs`)
- `SelfHealMonitor` (`selfheal.mjs`)

Target:

- Keep one exported façade: `SelfHealService`.
- Separate concerns internally:
  - health checks
  - auto-remediation
  - operational metrics/history

No endpoint behavior changes during merge.

## Migration Phases (Safe Slices)

### Phase 0: Freeze Contracts
- Snapshot all route responses via lightweight golden JSON fixtures.
- Keep existing E2E suite green before/after each phase.

### Phase 1: Infrastructure Extraction
- Add `src/server/http/*` helpers.
- Add `src/server/context.mjs` context builder.
- Keep route logic in `server.mjs` but routed through helpers.

### Phase 2: Low-Risk Routes
- Extract `health`, `ui`, `telegram`, `browser` route modules.
- Verify with phase0 + targeted browser/telegram smoke.

### Phase 3: Session + Mission Routes
- Extract session and mission handlers.
- Run `phase15.session-delete.e2e.mjs` and mission-related phases.

### Phase 4: Model + Provider/Auth Routes
- Extract model/config/auth routes and auth-job orchestration.
- Run provider and OAuth tests (phase12/phase13 where applicable).

### Phase 5: Tools/Skills/Research
- Extract tool execution and skills/research endpoints.
- Add route-level tests for error contracts.

### Phase 6: Autonomy Master + Runtime Insights
- Extract autonomy endpoints and runtime payload builders.

### Phase 7: Self-Heal Merge
- Unify `self-heal` + `selfheal` internals under one service.

### Phase 8: Cleanup
- Remove dead helpers from `server.mjs`.
- Keep `src/server.mjs` as thin bootstrap + router mount.

## Acceptance Criteria Per Phase

- Existing endpoint paths unchanged.
- Existing request/response fields unchanged (unless explicitly versioned).
- Existing E2E tests pass.
- No net-new uncaught exceptions in server logs under smoke tests.

## Execution Order Recommendation

1. Phase 1 + Phase 2 in one PR.
2. Phase 3 in next PR.
3. Phase 4 + Phase 5 split into separate PRs.
4. Phase 6 + Phase 7 after route extraction stabilizes.

## Proposed Immediate Next PR (What to do now)

- Create `src/server/http/{request,response,errors}.mjs`.
- Move existing parse/send helpers to those modules.
- Keep all route `if (...)` logic in `server.mjs` unchanged except helper imports.
- Add regression check script to compare core endpoint response shapes.

