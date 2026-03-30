# Project State Snapshot

Snapshot date: 2026-03-30

## What Works End-to-End

- Web UI chat with in-flight animation and expandable execution traces
- Provider/model selection and ranked model catalog loading
- Strict provider locking and autonomy mode presets
- Tool execution with retry/backoff via executor daemon
- Browser CDP control + launch checks
- Telegram channel polling and send loop
- Mission runner with proof-based done criteria + retries + hard caps
- Memory persistence and strategy outcome reuse

## Reliability Mechanisms

- Tool run persistence (`tool_runs`)
- Strategy outcome persistence (`strategy_outcomes`)
- Mission proof check (must observe new successful tool run)
- Forced provider lock option to prevent silent fallback

## Known Constraints

- OS/session constraints still apply (display/session permissions, user privileges, etc.)
- Headless/visible browser behavior depends on host desktop environment
- External provider behavior can vary by model and tool-calling compliance

## Minimum Commands for New Agent Session

```bash
cd /home/corp-unum/openunum
pnpm install
pnpm e2e
node src/server.mjs
curl -sS http://127.0.0.1:18880/api/health
curl -sS http://127.0.0.1:18880/api/config
```

## Recommended First Runtime Action

Set autonomy mode based on task criticality:

```bash
curl -sS -X POST http://127.0.0.1:18880/api/autonomy/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"relentless"}'
```
