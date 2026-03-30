# Agent Onboarding

Purpose: let a new coding agent understand OpenUnum quickly and operate safely/effectively.

## 1. What OpenUnum Is

OpenUnum is a local-first assistant runtime with:
- LLM chat + tool calling
- provider routing (`ollama`, `openrouter`, `nvidia`, generic OpenAI-compatible)
- browser automation through CDP
- Telegram channel integration
- autonomous mission loop with retries
- persistent memory in SQLite
- UI trace visibility for tool calls (expand/collapse)

Primary target OS/runtime: Ubuntu/Linux.

## 2. Current Runtime Invariants

- HTTP server is in `src/server.mjs`.
- Default bind: `127.0.0.1:18880`.
- Config file: `~/.openunum/openunum.json` (or `$OPENUNUM_HOME/openunum.json`).
- DB file: `~/.openunum/openunum.db`.
- Log directory: `~/.openunum/logs`.
- Tool runtime is centralized in `src/tools/runtime.mjs`.
- Autonomy mission engine is `src/core/missions.mjs`.

## 3. Hard Rules the Code Enforces

- Agent should not claim completion without tool evidence (system prompt behavior).
- Mission completion is proof-aware: `MISSION_STATUS: DONE` without new successful tool evidence is retried/fails.
- Optional strict provider lock: `model.routing.forcePrimaryProvider`.
- Autonomy mode presets can force strict routing and higher retries (`/api/autonomy/mode`).

## 4. Startup / Verification Checklist

1. Install deps:
```bash
pnpm install
```
2. Start server:
```bash
node src/server.mjs
```
3. Verify health:
```bash
curl -sS http://127.0.0.1:18880/api/health
```
4. Verify active model/routing:
```bash
curl -sS http://127.0.0.1:18880/api/config
```
5. Run full regression gate:
```bash
pnpm e2e
```

## 5. Key Operational Modes

- `standard` autonomy mode: balanced retries/iterations.
- `relentless` autonomy mode: increased retries and aggressive persistence, strict primary-provider behavior.

Switch via API:
```bash
curl -sS -X POST http://127.0.0.1:18880/api/autonomy/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"relentless"}'
```

## 6. What to Read Next (Immediate)

- [CODEBASE_MAP.md](/home/corp-unum/openunum/docs/CODEBASE_MAP.md)
- [API_REFERENCE.md](/home/corp-unum/openunum/docs/API_REFERENCE.md)
- [AUTONOMY_AND_MEMORY.md](/home/corp-unum/openunum/docs/AUTONOMY_AND_MEMORY.md)

## 7. Common Misdiagnosis to Avoid

- “Agent said done, so action happened.”
  - Wrong. Confirm tool results and trace in chat UI or memory tables.
- “Fallback provider used unexpectedly.”
  - Check `forcePrimaryProvider`, `fallbackEnabled`, and `fallbackProviders` in config.
- “Browser is available because port exists.”
  - CDP endpoint must return `json/version`; launch route checks readiness.
