# OpenUnum Architecture (Lean)

## Runtime
- Node.js 22+ (Ubuntu-native, stable ecosystem)
- TypeScript
- SQLite (single local DB file)

Note: Bun is possible later; Node first reduces integration risk with channel and browser SDKs.

## Modules

## `core/`
- `agent.ts`: main loop
- `session.ts`: context window, turns, metadata
- `router.ts`: model/provider routing + hot-switch

## `providers/`
- `ollama.ts`
- `openrouter.ts`
- `nvidia.ts`
- `openai_compatible.ts`

All providers implement:
- `generate()`
- `stream()`
- `listModels()`

## `tools/`
- `file.*`
- `shell.*`
- `browser.*`

Guardrails:
- per-tool timeout
- allowlist/denylist
- explicit approval for high-risk operations

## `browser/`
- `cdp_client.ts` for `127.0.0.1:9222`
- `managed_chromium.ts` fallback launcher

## `memory/`
- `store.ts` (SQLite tables: sessions, messages, facts, tool_events)
- `retrieval.ts` (keyword first, vector optional)

## `channels/`
- `telegram.ts` (grammY)
- `whatsapp.ts` (Baileys)

## `skills/`
- file-based local skills registry
- strict schema validation

## `ui/`
- lightweight web app
- mobile-first responsive layout
- no heavyweight dashboard framework initially

## Security Defaults
- CDP bind only `127.0.0.1`
- secrets only in env + local config file with strict permissions
- shell tool off by default until explicit enable

## Data Layout
- `~/.openunum/openunum.db`
- `~/.openunum/openunum.json`
- `~/.openunum/logs/`
- `~/.openunum/skills/`

