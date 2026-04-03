# Agent Onboarding

Purpose: let a fresh agent become productive in OpenUnum in under 15 minutes, with correct assumptions about routing, credentials, and mission reliability.

## 1. What OpenUnum Is

OpenUnum is a local-first autonomous coding runtime with:
- model chat + tool calling (`src/core/agent.mjs`, `src/tools/runtime.mjs`)
- provider routing and fallback control (`ollama`, `nvidia`, `openrouter`, `xiaomimimo`, `openai`)
- browser/CDP automation
- mission loop with proof-aware completion (`src/core/missions.mjs`)
- generic task planning/execution with restart-safe persistence (`src/core/goal-task-planner.mjs`, `src/core/task-orchestrator.mjs`)
- bounded workers + restart-safe worker persistence + self-edit promotion pipeline + model scout workflows (`src/core/worker-orchestrator.mjs`, `src/core/self-edit-pipeline.mjs`, `src/core/model-scout-workflow.mjs`)
- persistent memory/telemetry in SQLite (`src/memory/store.mjs`)
- operator trace/timeline visibility in WebUI (`src/ui/index.html`)
- enhanced proof validation and self-monitoring (`src/core/proof-scorer.mjs`, `src/core/self-monitor.mjs`)
- task tracking and progress monitoring (`src/core/task-tracker.mjs`)

Primary target: Ubuntu/Linux.

## 2. Fast Boot (First 15 Minutes)

1. Install and start:
```bash
cd /home/corp-unum/openunum
pnpm install
node src/server.mjs
```
2. Confirm service liveness:
```bash
curl -sS http://127.0.0.1:18880/api/health | jq .
```
3. Confirm selected model/provider:
```bash
curl -sS http://127.0.0.1:18880/api/model/current | jq .
```
4. Confirm provider auth/base-url readiness:
```bash
curl -sS http://127.0.0.1:18880/api/providers/config | jq .
curl -sS http://127.0.0.1:18880/api/auth/catalog | jq .
```
5. Run the current controller/behavior gate:
```bash
pnpm -s phase14:e2e
```
6. Run safe UI/API smoke (does not trigger OAuth browser/terminal approval flows):
```bash
pnpm -s smoke:ui:noauth
```
7. Confirm planner-backed autonomy surfaces:
```bash
curl -sS -X POST http://127.0.0.1:18880/api/autonomy/tasks/plan \
  -H 'Content-Type: application/json' \
  -d '{"goal":"inspect runtime state and report proof"}' | jq .
curl -sS http://127.0.0.1:18880/api/runtime/inventory | jq .
```
8. Refresh dataset intelligence artifacts used by recovery synthesis:
```bash
pnpm -s hf:explore
pnpm -s hf:pilot
```

## 3. Runtime Invariants

- Server entry: `src/server.mjs` on `127.0.0.1:18880` by default.
- Config file: `~/.openunum/openunum.json` (sanitized, non-secret).
- Secret store: `~/.openunum/secrets.json` (real provider keys/tokens, mode `0600`).
- DB: `~/.openunum/openunum.db`.
- Logs: `~/.openunum/logs/*`.
- Hook scripts: `~/.openunum/hooks/*.mjs`.

### House Map (What/Where To Edit)

- UI house: `src/ui/index.html` (primary UI structure + inlined CSS/JS).
- Agent/controller house: `src/core/agent.mjs`.
- Goal compiler house: `src/core/goal-task-planner.mjs`.
- Generic autonomy runtime house: `src/core/task-orchestrator.mjs`.
- Worker/self-edit/model-scout houses:
  - `src/core/worker-orchestrator.mjs`
  - `src/core/self-edit-pipeline.mjs`
  - `src/core/model-scout-workflow.mjs`
- Shared autonomy wiring house: `src/core/autonomy-registry.mjs`.
- Tool capability house: `src/tools/runtime.mjs`.
- API composition house: `src/server.mjs`.
- API route house: `src/server/routes/*.mjs`.
- API service/runtime house: `src/server/services/*.mjs`.
- Persistence house: `src/memory/store.mjs`.
- Proof validation house: `src/core/proof-scorer.mjs`.
- Task tracking house: `src/core/task-tracker.mjs`.
- Self-monitoring house: `src/core/self-monitor.mjs`.
- Execution contract house: `src/core/execution-contract.mjs`.

## 3b. Anti-Stuck Mechanisms (Critical)

**Self-Monitoring Initialization:** The agent uses automatic continuation to prevent stalling:

```javascript
// In src/core/agent.mjs chat() method:
this.selfMonitor.startMonitoring(sessionId, message);
```

**If this line is missing:**
- Agent will execute tools but stall mid-task
- `shouldAutoContinue()` returns `false` immediately
- User must manually prompt ("Done?", "Continue") to finish

**Symptoms of broken auto-continue:**
- Multi-step tasks complete 1-2 steps then stop
- Agent responds with planning text but no action
- Logs show no errors, just silence

**Fix:** Ensure `startMonitoring(sessionId, message)` is called at the start of every `chat()` turn.

**Related modules:**
- `src/core/self-monitor.mjs` — Monitors progress, triggers auto-continue
- `src/core/proof-scorer.mjs` — Validates completion quality (0.0–1.0 score)
- `src/core/execution-contract.mjs` — Enforces proof-backed completion claims

Before broad filesystem discovery, read `GET /api/tools/catalog` and target these canonical files first.

## 4. Credential Truth Sources (Critical)

- Do not use `GET /api/config` key fields to infer provider readiness.
- `GET /api/config` is intentionally scrubbed.
- Use:
  - `GET /api/providers/config` for `has*ApiKey` booleans.
  - `GET /api/auth/catalog` for redacted stored/auth/source state.
  - `POST /api/auth/prefill-local` to import local provider creds from known sources.

## 5. Mission Controller Rules

- Proof-backed completion is enforced: completion claims without evidence are rejected/retried.
- Mission completion contracts are explicit and autonomous:
  - each mission uses a contract id (`local-runtime-proof-v1`, `coding-proof-v1`, or `generic-proof-v1`)
  - `MISSION_STATUS: DONE` is accepted only when contract checkpoint/proof conditions pass
- Mission turn watchdog prevents indefinite step hangs during long/blocked provider calls.
- Local-runtime missions use route-specific recovery hints and provider-aware pivoting.
- Model execution envelopes are enforced by runtime tier (`compact`/`balanced`/`full`) and can reduce tool exposure/iteration budget for smaller models.
- Execution policy engine is autonomous-first:
  - `runtime.autonomyPolicy.mode` controls `plan` vs `execute`
  - self-protection policy blocks self-destructive shell actions by default
  - no human confirmation loop is required for normal policy decisions
- Provider fallback is deterministic and typed:
  - failures are classified (`timeout`, `network`, `auth`, `not_found`, `quota`, `rate_limited`, `unknown`)
  - fallback actions are class-driven with provider cooldown windows
  - inspect `/api/runtime/overview` `providerAvailability` when routing appears constrained
- Controller behavior classes and learned tuning are tracked/persisted:
  - `src/core/model-behavior-registry.mjs`
  - `GET /api/controller/behaviors`
- Manual behavior controls are available for operator correction:
  - `GET /api/controller/behavior-classes`
  - `POST /api/controller/behavior/override`
  - `POST /api/controller/behavior/override/remove`
  - `POST /api/controller/behavior/reset`
  - `POST /api/controller/behavior/reset-all`
- Mission route-learning is persisted and reused:
  - route signatures are learned from tool outcomes
  - repeated failing routes are deprioritized
  - historically successful routes are hinted early in runtime guidance

## 6. Generic Task Framework Rules

- `POST /api/autonomy/tasks/plan` compiles a plain-language goal into a bounded task graph.
- `POST /api/autonomy/tasks/run` accepts either:
  - explicit `steps`
  - or just a `goal`, in which case the planner synthesizes the task graph
- Planner-backed tasks can preflight with:
  - `browser_search`
  - `http_request`
  - `shell_run`
  - optional `model_scout`
  before handing off to a mission step.
- Planner intent policies now include bounded preflights for:
  - `deploy`
  - `benchmark`
  - `sync`
  - `diagnose`
  - `cleanup`
- Generic task runs are persisted:
  - `task_records`
  - `task_step_results`
  - `task_check_results`
- `/auto <goal>` in chat now uses this generic task framework, not a hardcoded one-step mission payload.
- Mission steps can share the same task session id, so preflight evidence and autonomous execution land in one memory/thread.

## 7. Common Failure Patterns + First Checks

- Mission appears stuck:
  - check `/api/missions/status?id=...` and `/api/missions/timeline?id=...`
  - confirm `finishedAt`, `error`, and `recoveryHint` progression
- Task appears stuck or disappears after restart:
  - check `/api/autonomy/tasks?limit=20`
  - inspect `/api/autonomy/tasks/status?id=...`
  - persisted tasks should survive restart as `completed`, `failed`, or `interrupted`
- Provider seems unavailable:
  - verify `/api/providers/config` and `/api/auth/catalog`
  - confirm current runtime model via `/api/model/current`
- Local model tests are slow or hanging:
  - inspect live model processes (`ollama ps`, `ps aux | rg ollama`)
  - avoid interactive-only paths when bounded API checks exist
- Small model appears to stall or over-call tools:
  - inspect `/api/runtime/overview` -> `executionEnvelope`
  - tune `runtime.modelExecutionProfiles` and `runtime.enforceModelExecutionProfiles`
- Mission keeps claiming done without proof:
  - inspect `/api/missions/status` and `/api/missions/timeline` contract metadata
  - OpenUnum can trigger one autonomous rollback via `file_restore_last` when repeated contract failures occur
- Assistant returns raw tool-call XML/markup instead of a real final answer:
  - controller now normalizes non-native tool-call markup (for example `<minimax:tool_call>`) as non-final content
  - when UI no-scrollbar intent is detected and no concrete patch is produced, deterministic recovery edits `src/ui/index.html`
- Assistant says `Tool actions executed (...) but model returned no final message`:
  - inspect the latest executed actions in the fallback response and the execution trace
  - OpenUnum now tries a deterministic evidence-based summary before falling back to a raw action dump
  - common causes are restricted tool profiles on small models or a provider/model that stops after tool use without a final natural-language turn

## 8. Operational Modes

- `standard`: balanced.
- `relentless`: higher persistence, stronger mission defaults.

Switch:
```bash
curl -sS -X POST http://127.0.0.1:18880/api/autonomy/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"relentless"}'
```

## 9. Read Next (Required Order)

1. [CODEBASE_MAP.md](/home/corp-unum/openunum/docs/CODEBASE_MAP.md)
2. [API_REFERENCE.md](/home/corp-unum/openunum/docs/API_REFERENCE.md)
3. [AUTONOMY_AND_MEMORY.md](/home/corp-unum/openunum/docs/AUTONOMY_AND_MEMORY.md)
4. [MODEL_AWARE_CONTROLLER.md](/home/corp-unum/openunum/docs/MODEL_AWARE_CONTROLLER.md)
5. [COMPETITIVE_ANALYSIS_CLAW_CODE.md](/home/corp-unum/openunum/docs/COMPETITIVE_ANALYSIS_CLAW_CODE.md)
6. [COMPETITIVE_ANALYSIS_OPENAI_CODEX.md](/home/corp-unum/openunum/docs/COMPETITIVE_ANALYSIS_OPENAI_CODEX.md)
7. [COMPETITIVE_ANALYSIS_GEMINI_CLI.md](/home/corp-unum/openunum/docs/COMPETITIVE_ANALYSIS_GEMINI_CLI.md)
8. [COMPETITIVE_ANALYSIS_MIMOUNUM.md](/home/corp-unum/openunum/docs/COMPETITIVE_ANALYSIS_MIMOUNUM.md)
9. [OPENUNUM_MULTI_MODEL_CONTROLLER_ACTION_PLAN.md](/home/corp-unum/openunum/docs/OPENUNUM_MULTI_MODEL_CONTROLLER_ACTION_PLAN.md)

## 10. Misdiagnosis to Avoid

- "The model said done, so the task is done."
  - Validate tool outputs and mission proof markers.
- "`/auto` is just a mission shortcut."
  - Not anymore. It is planner-backed generic task execution.
- "No keys in /api/config means no credentials."
  - Wrong surface; check provider/auth endpoints above.
- "Fallback happened unexpectedly."
  - Inspect `model.routing.forcePrimaryProvider`, `fallbackEnabled`, and `fallbackProviders`.
- "OAuth popups during basic smoke checks are normal."
  - They are not required for routine checks. Use `pnpm smoke:ui:noauth` and avoid `/api/service/connect` unless explicitly validating OAuth flows.
