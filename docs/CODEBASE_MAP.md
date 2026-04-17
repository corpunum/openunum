# Codebase Map

This map is implementation-accurate as of 2026-04-09.

## Top-Level Structure

- `src/server.mjs`: HTTP API server and Web UI host
- `src/server/routes/*.mjs`: extracted route handlers (health, ui, sessions, missions, model, auth, config, autonomy, chat/tools, browser, telegram, research, **providers**, **state**, **roles**, **approvals**, **audit**, **verifier**, **memory-freshness**)
- `src/server/services/*.mjs`: extracted runtime helpers (chat, auth jobs, browser runtime, telegram runtime, research runtime, config service, auth service)
- `src/core/agent.mjs`: provider chat loop, tool-call execution, trace generation, role-model escalation
- `src/core/missions.mjs`: autonomous mission runner with proof-aware completion
- `src/core/goal-task-planner.mjs`: deterministic goal-to-task compiler for planner-backed autonomy
- `src/core/task-orchestrator.mjs`: generic task executor with steps, verification, monitoring, and persistence
- `src/core/worker-orchestrator.mjs`: bounded internal workers with tool allowlists
- `src/core/self-edit-pipeline.mjs`: self-edit validation/canary/rollback promotion pipeline
- `src/core/model-scout-workflow.mjs`: bounded online model discovery/download/monitor workflow
- `src/core/autonomy-registry.mjs`: shared autonomy singletons wired into routes
- `src/core/model-behavior-registry.mjs`: behavior classes + runtime learning hints per provider/model
- `src/core/context-pack-builder.mjs`: behavior-aware context/system pack assembly
- `src/core/execution-contract.mjs`: deterministic continuation and proof-backed completion checks
- `src/core/council/safety-council.mjs`: **UPDATED** — ODD enforcement wired to `resolveExecutionEnvelope()` tier allowlists; self-preservation and shell protection checks
- `src/core/model-execution-envelope.mjs`: execution tier resolution (compact/balanced/full) with tool allowlists
- `src/core/execution-policy-engine.mjs`: shell self-protection policy enforcement
- `src/core/completion-checklist.mjs`: task step tracking, prevents premature "Done" declarations
- `src/core/alternative-paths.mjs`: suggests alternative tools when failures occur
- `src/core/task-decomposer.mjs`: breaks complex tasks into explicit steps at start
- `src/core/context-pressure.mjs`: monitors context size, compacts when approaching limits
- `src/core/confidence-scorer.mjs`: scores confidence in outputs, triggers verification if low
- `src/core/audit-log.mjs`: **UPDATED** — Tamper-evident HMAC-SHA256 chain hashing with canonical storage at `OPENUNUM_HOME/audit/audit-log.jsonl`
- `src/core/verifier.mjs`: **UPDATED** — Independent 5-check verification (tool appropriateness, output quality, goal alignment, safety compliance, context coherence)
- `src/core/memory-consolidator.mjs`: **NEW** — Hippocampal replay with scheduled consolidation
- `src/core/state-diff.mjs`: **NEW** — Structured diff computation before state changes
- `src/core/merkle-tree.mjs`: **NEW** — Merkle root computation for state commitments
- `src/core/sleep-cycle.mjs`: **NEW** — Idle-triggered aggressive compaction
- `src/core/finality.mjs`: **UPDATED** — Stable, persisted finality confirmations after N verified tool runs
- `src/core/role-model-registry.mjs`: **UPDATED** — Task-type to model-tier mapping with real tier enforcement in `agent.mjs`
- `src/core/turn-recovery-summary.mjs`: bounded evidence-based summaries on tool failures
- `src/tools/runtime.mjs`: unified tool schema + execution routing + tool-result verification + finality tracking
- `src/tools/tool-contracts.mjs`: canonical tool schema/validation contract source
- `src/tools/backends/registry.mjs`: model-backed logical tool backend resolution/execution
- `src/tools/backends/contracts.mjs`: logical tool contracts + output normalization
- `src/tools/backends/profiles.mjs`: backend profile resolution from config/defaults
- `src/tools/backends/governor.mjs`: bounded local model-backed execution queue/concurrency
- `src/tools/executor-daemon.mjs`: retry/backoff executor with JSONL logs
- `src/tools/google-workspace.mjs`: native Google Workspace OAuth + Gmail/Google API client
- `src/oauth/google-workspace.mjs`: Google installed-app PKCE helpers and token refresh
- `src/skills/manager.mjs`: reviewed skill lifecycle (install/review/approve/execute/uninstall)
- `src/research/manager.mjs`: daily research pipeline + review queue
- `src/core/autonomy-master.mjs`: continuous autonomy coordinator (self-heal, self-test, self-improve, skill learning, death-spiral detection, memory consolidation triggers)
- `src/core/context-budget.mjs`: model-aware context window estimation + token usage checks
- `src/core/context-compact.mjs`: old-message compaction and artifact extraction
- `src/memory/store.mjs`: SQLite persistence for sessions/messages/facts/tool runs/strategy outcomes plus mission/task durability **+ state roots**
- `src/memory/recall.mjs`: **UPDATED** — Hybrid retrieval with BM25 + embeddings + freshness decay (30% weight) via `applyFreshnessAndReturn()`
- `src/memory/freshness-decay.mjs`: **UPDATED** — Now wired into `HybridRetriever` (was documented but previously unused)
- `src/browser/cdp.mjs`: Chrome DevTools Protocol abstraction
- `src/providers/*`: provider adapters **+ retry policy + health tracking**
- `src/models/catalog.mjs`: provider model discovery/ranking + OpenClaw key import
- `src/ui/index.html`: menu-driven Web UI and chat trace renderer
- `src/channels/telegram.mjs`: Telegram poll/send loop
- `src/cli.mjs`: command-line entry

## Runtime Notes

- Audit, verifier, and memory freshness APIs are handled through active route modules (`src/server/routes/audit.mjs`, `src/server/routes/verifier.mjs`, `src/server/routes/memory-freshness.mjs`) wired by `src/server.mjs`.
- Web UI now prefers SSE pending stream updates via `GET /api/chat/stream` with adaptive activity polling fallback in `src/ui/index.html`.
- Agent runtime includes a feature-based short-turn fast path (length + intent signals) for low-intent conversational turns to avoid unnecessary provider/tool cycles.

## Request Flow (Chat)

1. UI posts `/api/chat` with `sessionId` + `message`.
2. `server.mjs` calls `agent.chat(...)`.
3. `agent.mjs` builds provider attempt list (strict primary or fallback list).
4. Provider returns assistant output + tool calls.
5. Tool calls execute via `ToolRuntime`, backed by `ExecutorDaemon`.
6. Tool results persist in `tool_runs` table.
7. Agent returns final response + structured execution trace.
8. UI renders message + expandable trace.
9. When the run is pending, UI uses `/api/sessions/:sessionId/activity?since=...` as primary polling source with adaptive intervals; final message hydration does one direct session refresh.
10. When the message starts with `/auto`, chat launches a planner-backed generic task and writes the task summary back into the same session.
11. `trace.latency` includes stage timings (`awarenessMs`, `providerMs`, `continuationMs`, `persistenceMs`, `totalMs`) for runtime profiling.

## Planner-Backed Task Flow

1. UI/API calls `POST /api/autonomy/tasks/plan` or `POST /api/autonomy/tasks/run` with a plain-language goal.
2. `GoalTaskPlanner` classifies the goal and synthesizes bounded preflight steps.
3. `TaskOrchestrator` executes task steps (`tool`, `mission`, `worker`, `self_edit`, `model_scout`, `delay`).
4. Verification and monitoring checks run after execution.
5. Task state persists in SQLite:
   - `task_records`
   - `task_step_results`
   - `task_check_results`
6. `GET /api/autonomy/tasks` and `GET /api/autonomy/tasks/status` survive restart because they read persisted state.

## Autonomous Mission Flow

1. UI/API calls `/api/missions/start`.
2. Mission loop repeatedly calls `agent.chat(...)`.
3. Loop checks proof: successful tool-run count must increase for true completion.
4. `MISSION_STATUS: DONE` without new proof triggers retries.
5. Outcomes persist to `strategy_outcomes` for future strategy hints.
6. Missions launched from generic tasks can reuse the task session id so preflight evidence and mission execution share one thread.

## Provider Layer

- `src/providers/ollama.mjs`: uses Ollama `/api/chat`
- `src/providers/openai-compatible.mjs`: uses `/chat/completions`
- `src/providers/openai-codex-oauth.mjs`: uses ChatGPT Codex OAuth + `/codex/responses`
- `src/providers/index.mjs`: provider selection and model normalization

## Tool Layer (Current Tool Names)

- `file_read`
- `file_write`
- `file_patch`
- `shell_run`
- `browser_status`
- `browser_navigate`
- `browser_search`
- `browser_type`
- `browser_click`
- `browser_extract`
- `browser_snapshot`
- `http_download`
- `desktop_open`
- `desktop_xdotool`
- `http_request`
- `skill_list`
- `skill_forge`
- `skill_load`
- `skill_install`
- `skill_review`
- `skill_approve`
- `skill_execute`
- `skill_uninstall`
- `email_status`
- `email_send`
- `email_list`
- `email_read`
- `gworkspace_call`
- `research_run_daily`
- `research_list_recent`
- `research_review_queue`
- `research_approve`
- `summarize` (model-backed logical tool)
- `classify` (model-backed logical tool)
- `extract` (model-backed logical tool)
- `parse_function_args` (model-backed logical tool)
- `embed_text` (model-backed logical tool)

## Config Layer

- Source of truth defaults: `src/config.mjs`
- Persisted runtime config: `~/.openunum/openunum.json`
- `withDefaults(...)` merges old configs with newly-added fields safely.

## Logs / Data

- SQLite DB: `~/.openunum/openunum.db`
- Executor JSONL: `~/.openunum/logs/executor.jsonl`
- Research reports: `~/.openunum/research/research-YYYY-MM-DD.json`
- Research approval queue: `~/.openunum/research/review-queue.json`
- Skill manifest: `~/.openunum/skills/manifest.json`
- Tool hooks: `~/.openunum/hooks/pre-tool*.mjs`, `~/.openunum/hooks/post-tool*.mjs`
- Context compactions: `session_compactions` table in `~/.openunum/openunum.db`
- Context artifacts: `memory_artifacts` table in `~/.openunum/openunum.db`
- Task persistence: `task_records`, `task_step_results`, `task_check_results` in `~/.openunum/openunum.db`
- Runtime inventory ledger: derived from persisted facts and exposed at `/api/runtime/inventory`

## Important Couplings

- `server.mjs` -> `agent.reloadTools()` must be called after runtime/config mutations that impact tools.
- `MissionRunner` depends on `MemoryStore.countSuccessfulToolRuns(...)` for proof checks.
- `TaskOrchestrator` depends on `GoalTaskPlanner` when `runTask(...)` receives only a goal.
- `MissionRunner.start(...)` now accepts external `sessionId` when task and mission evidence must land in one session.
- UI trace display expects `out.trace` in `/api/chat` response.
- UI OAuth connect actions can launch browser/terminal approval windows (`/api/service/connect`); routine smoke checks should use `pnpm smoke:ui:noauth`.
