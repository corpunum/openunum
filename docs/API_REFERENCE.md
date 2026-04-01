# API Reference

Base URL: `http://127.0.0.1:18880`

## Health

- `GET /health`
- `GET /api/health`

Returns:
```json
{"ok":true,"service":"openunum"}
```

## Config

- `GET /api/config`
- `POST /api/config`

`GET /api/config` now also returns:
- `capabilities`
- `modelCatalog`
- `providerConfig`

`POST` accepts (partial):
- `runtime.shellEnabled: boolean`
- `runtime.workspaceRoot: string`
- `runtime.ownerControlMode: "safe"|"owner-unlocked"|"owner-unrestricted"`
- `runtime.selfPokeEnabled: boolean`
- `runtime.toolCircuitFailureThreshold: number`
- `runtime.toolCircuitCooldownMs: number`
- `runtime.autonomyMasterAutoStart: boolean`
- `runtime.researchDailyEnabled: boolean`
- `runtime.researchScheduleHour: number`
- `runtime.contextCompactionEnabled: boolean`
- `runtime.contextCompactTriggerPct: number`
- `runtime.contextCompactTargetPct: number`
- `runtime.contextHardFailPct: number`
- `runtime.contextProtectRecentTurns: number`
- `runtime.contextFallbackTokens: number`
- `runtime.maxToolIterations: number`
- `runtime.executorRetryAttempts: number`
- `runtime.executorRetryBackoffMs: number`
- `runtime.providerRequestTimeoutMs: number`
- `runtime.agentTurnTimeoutMs: number`
- `runtime.autonomyMode: string`
- `runtime.missionDefaultContinueUntilDone: boolean`
- `runtime.missionDefaultHardStepCap: number`
- `runtime.missionDefaultMaxRetries: number`
- `runtime.missionDefaultIntervalMs: number`
- `model.routing.*`
- `integrations.googleWorkspace.cliCommand: string`

## Autonomy Mode

- `GET /api/autonomy/mode`
- `POST /api/autonomy/mode`

Payload:
```json
{"mode":"autonomy-first"}
```
or
```json
{"mode":"relentless"}
```

## Autonomy Master

- `GET /api/autonomy/master/status`
- `POST /api/autonomy/master/start`
- `POST /api/autonomy/master/stop`
- `POST /api/autonomy/master/cycle`
- `POST /api/autonomy/master/self-improve`
- `POST /api/autonomy/master/learn-skills`
- `POST /api/autonomy/master/self-test`

## Capabilities

- `GET /api/capabilities`

Returns:
```json
{
  "contract_version": "2026-04-01.webui-capabilities.v1",
  "menu": ["chat", "missions", "trace", "runtime", "settings"],
  "provider_order": ["ollama", "nvidia", "openrouter", "openai"]
}
```

## Runtime Overview

- `GET /api/runtime/overview`
- `GET /api/autonomy/insights?sessionId=...&goal=...`
- `GET /api/missions/timeline?id=...`

Returns a WebUI-oriented flagship summary:
- `workspaceRoot`
- `autonomyMode`
- `browser`
- `git`
- `selectedModel`
- `fallbackModel`
- `providers[]` with `status`, `topModel`, and `modelCount`

`GET /api/autonomy/insights` returns:
- `sessionId`
- `goal`
- `context`
- `recentStrategies[]`
- `toolReliability[]`
- `recentToolRuns[]`
- `recentCompactions[]`

`GET /api/missions/timeline` returns:
- `mission`
- `log[]`
- `toolRuns[]`
- `compactions[]`
- `artifacts[]`
- `recentStrategies[]`

## Provider Config + Discovery

- `GET /api/providers/config`
- `POST /api/providers/config`
- `POST /api/providers/import-openclaw`
- `GET /api/models?provider=ollama|nvidia|openrouter|openai`
- `GET /api/model-catalog`

`GET /api/providers/config` returns canonical OpenAI fields plus legacy aliases:
- `openaiBaseUrl`
- `genericBaseUrl`
- `hasOpenaiApiKey`
- `hasGenericApiKey`

`GET /api/model-catalog` returns the canonical model-catalog contract:
```json
{
  "contract_version": "2026-04-01.model-catalog.v1",
  "provider_order": ["ollama", "nvidia", "openrouter", "openai"],
  "selected": {
    "provider": "ollama",
    "model_id": "kimi-k2.5:cloud",
    "canonical_key": "ollama/kimi-k2.5:cloud"
  },
  "fallback": {
    "provider": "nvidia",
    "model_id": "qwen/qwen3-coder-480b-a35b-instruct",
    "canonical_key": "nvidia/qwen/qwen3-coder-480b-a35b-instruct"
  }
}
```

## Model Runtime

- `GET /api/model/current`
- `POST /api/model/switch`

Switch payload:
```json
{"provider":"ollama","model":"ollama/qwen3.5:397b-cloud"}
```

## Chat

- `POST /api/chat`
- `GET /api/chat/pending?sessionId=...`

Payload:
```json
{"sessionId":"abc","message":"do X"}
```

`POST /api/chat` response includes:
- `reply`
- `replyHtml`
- `model`
- `trace` (iterations/tool calls/failures)

`trace` now also carries flagship execution metadata:
- `routedTools`
- `permissionDenials`
- `turnSummary`
- `pivotHints`

Long-running behavior:
- When a turn is still running, `POST /api/chat` returns `202` with:
```json
{"ok":true,"pending":true,"sessionId":"abc","startedAt":"...","note":"chat_still_running"}
```
- `GET /api/chat/pending?sessionId=abc` returns:
```json
{"ok":true,"pending":true,"sessionId":"abc","startedAt":"..."}
```
or
```json
{"ok":true,"pending":false,"sessionId":"abc"}
```

## Direct Tool Run

- `POST /api/tool/run`

Payload:
```json
{"name":"shell_run","args":{"cmd":"ls -la"}}
```

## Context

- `GET /api/context/status?sessionId=...`
- `POST /api/context/compact`
- `GET /api/context/compactions?sessionId=...`
- `GET /api/context/artifacts?sessionId=...`

`GET /api/context/status` returns:
- `sessionId`
- `messageCount`
- `estimatedTokens`
- `budget.contextLimit`
- `budget.usagePct`
- `latestCompaction`

## Sessions

- `POST /api/sessions`
- `POST /api/sessions/import`
- `POST /api/sessions/clone`
- `GET /api/sessions?limit=120`
- `GET /api/sessions/:sessionId`
- `GET /api/sessions/:sessionId/activity?since=...`
- `GET /api/sessions/:sessionId/export`

`GET /api/sessions/:sessionId/export` returns:
- `sessionId`
- `summary`
- `exportedAt`
- `estimatedTokens`
- `messages[]`

`POST /api/sessions/import` accepts:
- `sessionId`
- `messages[]`

`POST /api/sessions/clone` accepts:
- `sourceSessionId`
- `targetSessionId`

## Skills

- `GET /api/skills`
- `POST /api/skills/install`
- `POST /api/skills/review`
- `POST /api/skills/approve`
- `POST /api/skills/execute`
- `POST /api/skills/uninstall`

## Google Workspace / Email

- `GET /api/email/status`
- `POST /api/email/send`
- `POST /api/email/list`
- `POST /api/email/read`
- `POST /api/gworkspace/call`

Email support is implemented via `googleworkspace/cli` (`gws`).

## Research

- `POST /api/research/run` (supports `{ "simulate": true }`)
- `GET /api/research/recent?limit=10`
- `GET /api/research/queue?limit=50`
- `POST /api/research/approve`

## Session History

- `GET /api/sessions/:sessionId`
- `GET /api/sessions/:sessionId/activity?since=<ISO8601>`

Activity response includes:
- `pending` (whether session currently has an active chat run)
- `toolRuns` (tool call stream with args/results since timestamp)
- `messages` (messages since timestamp)

## Missions

- `GET /api/missions`
- `GET /api/missions/status?id=...`
- `POST /api/missions/start`
- `POST /api/missions/stop`

Start payload (partial):
```json
{
  "goal":"download model",
  "maxSteps":6,
  "maxRetries":3,
  "intervalMs":400,
  "continueUntilDone":true,
  "hardStepCap":120
}
```

## Browser

- `GET /api/browser/status`
- `POST /api/browser/navigate`
- `POST /api/browser/search`
- `POST /api/browser/extract`
- `GET /api/browser/config`
- `POST /api/browser/config`
- `POST /api/browser/launch`

## Telegram

- `GET /api/telegram/config`
- `POST /api/telegram/config`
- `GET /api/telegram/status`
- `POST /api/telegram/start`
- `POST /api/telegram/stop`

## UI

- `GET /`
- `GET /index.html`
