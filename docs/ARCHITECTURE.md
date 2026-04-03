# OpenUnum Architecture (Current)

## Runtime

- Node.js 22+ (ES modules)
- SQLite local persistence
- Ubuntu/Linux-first operation

## Server Shape

- Entry/composition: `src/server.mjs`
- Route modules: `src/server/routes/*.mjs`
- Runtime/service modules: `src/server/services/*.mjs`
- HTTP helpers: `src/server/http.mjs`

`src/server.mjs` now primarily wires context, shared state, and route dispatch.

## Core Engine

- `src/core/agent.mjs`: provider chat loop, tool-call orchestration, trace generation
- `src/core/missions.mjs`: mission runner + proof-backed completion
- `src/core/execution-policy-engine.mjs`: autonomous policy decisions and safety blocks
- `src/core/provider-fallback-policy.mjs`: failure classification + deterministic fallback
- `src/core/model-execution-envelope.mjs`: profile-aware tool/context limits

## Providers

- `src/providers/ollama.mjs`
- `src/providers/openai-compatible.mjs`
- `src/providers/openai-codex-oauth.mjs`
- `src/providers/index.mjs` (provider selection + normalization)

## Tools + Channels

- Tool runtime: `src/tools/runtime.mjs`
- Executor daemon: `src/tools/executor-daemon.mjs`
- Browser/CDP: `src/browser/cdp.mjs`
- Telegram: `src/channels/telegram.mjs`
- Google Workspace native OAuth/API: `src/tools/google-workspace.mjs`, `src/oauth/google-workspace.mjs`

## UI

- Primary UI: `src/ui/index.html`
- Legacy standalone visual preview: `src/ui/new_ui.html`
- UI is capability-driven via backend endpoints (`/api/capabilities`, `/api/model-catalog`, `/api/runtime/overview`, `/api/auth/catalog`).

## Persistence + Data Paths

- Config: `~/.openunum/openunum.json` (sanitized)
- Secrets: `~/.openunum/secrets.json` (0600)
- DB: `~/.openunum/openunum.db`
- Logs: `~/.openunum/logs/*`
- Skills: `~/.openunum/skills/*`
- Backups: `~/.openunum/backups/*`

## Security Defaults

- CDP expected on localhost endpoint
- Secret values never returned from `GET /api/config`
- Shell/tool safety policy enabled by default through execution policy engine

