# Codebase Map

This map is implementation-accurate as of 2026-03-30.

## Top-Level Structure

- `src/server.mjs`: HTTP API server and Web UI host
- `src/core/agent.mjs`: provider chat loop, tool-call execution, trace generation
- `src/core/missions.mjs`: autonomous mission runner with proof-aware completion
- `src/tools/runtime.mjs`: unified tool schema + execution routing
- `src/tools/executor-daemon.mjs`: retry/backoff executor with JSONL logs
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

## Config Layer

- Source of truth defaults: `src/config.mjs`
- Persisted runtime config: `~/.openunum/openunum.json`
- `withDefaults(...)` merges old configs with newly-added fields safely.

## Logs / Data

- SQLite DB: `~/.openunum/openunum.db`
- Executor JSONL: `~/.openunum/logs/executor.jsonl`

## Important Couplings

- `server.mjs` -> `agent.reloadTools()` must be called after runtime/config mutations that impact tools.
- `MissionRunner` depends on `MemoryStore.countSuccessfulToolRuns(...)` for proof checks.
- UI trace display expects `out.trace` in `/api/chat` response.
