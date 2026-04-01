# Codebase Map

This map is implementation-accurate as of 2026-03-31.

## Top-Level Structure

- `src/server.mjs`: HTTP API server and Web UI host
- `src/core/agent.mjs`: provider chat loop, tool-call execution, trace generation
- `src/core/missions.mjs`: autonomous mission runner with proof-aware completion
- `src/tools/runtime.mjs`: unified tool schema + execution routing
- `src/tools/executor-daemon.mjs`: retry/backoff executor with JSONL logs
- `src/tools/google-workspace.mjs`: Google Workspace CLI (`gws`) integration for Gmail + generic API calls
- `src/skills/manager.mjs`: reviewed skill lifecycle (install/review/approve/execute/uninstall)
- `src/research/manager.mjs`: daily research pipeline + review queue
- `src/core/autonomy-master.mjs`: continuous autonomy coordinator (self-heal, self-test, self-improve, skill learning)
- `src/core/context-budget.mjs`: model-aware context window estimation + token usage checks
- `src/core/context-compact.mjs`: old-message compaction and artifact extraction
- `src/memory/store.mjs`: SQLite persistence for sessions/messages/facts/tool runs/strategy outcomes
- `src/browser/cdp.mjs`: Chrome DevTools Protocol abstraction
- `src/providers/*`: provider adapters
- `src/models/catalog.mjs`: provider model discovery/ranking + OpenClaw key import
- `src/ui/index.html`: menu-driven Web UI and chat trace renderer
- `src/channels/telegram.mjs`: Telegram poll/send loop
- `src/cli.mjs`: command-line entry

## Request Flow (Chat)

1. UI posts `/api/chat` with `sessionId` + `message`.
2. `server.mjs` calls `agent.chat(...)`.
3. `agent.mjs` builds provider attempt list (strict primary or fallback list).
4. Provider returns assistant output + tool calls.
5. Tool calls execute via `ToolRuntime`, backed by `ExecutorDaemon`.
6. Tool results persist in `tool_runs` table.
7. Agent returns final response + structured execution trace.
8. UI renders message + expandable trace.

## Autonomous Mission Flow

1. UI/API calls `/api/missions/start`.
2. Mission loop repeatedly calls `agent.chat(...)`.
3. Loop checks proof: successful tool-run count must increase for true completion.
4. `MISSION_STATUS: DONE` without new proof triggers retries.
5. Outcomes persist to `strategy_outcomes` for future strategy hints.

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
- `skill_list`
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
- Context compactions: `session_compactions` table in `~/.openunum/openunum.db`
- Context artifacts: `memory_artifacts` table in `~/.openunum/openunum.db`

## Important Couplings

- `server.mjs` -> `agent.reloadTools()` must be called after runtime/config mutations that impact tools.
- `MissionRunner` depends on `MemoryStore.countSuccessfulToolRuns(...)` for proof checks.
- UI trace display expects `out.trace` in `/api/chat` response.
