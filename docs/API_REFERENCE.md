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

`POST` accepts (partial):
- `runtime.shellEnabled: boolean`
- `runtime.maxToolIterations: number`
- `runtime.executorRetryAttempts: number`
- `runtime.executorRetryBackoffMs: number`
- `runtime.autonomyMode: string`
- `runtime.missionDefaultContinueUntilDone: boolean`
- `runtime.missionDefaultHardStepCap: number`
- `runtime.missionDefaultMaxRetries: number`
- `runtime.missionDefaultIntervalMs: number`
- `model.routing.*`

## Autonomy Mode

- `GET /api/autonomy/mode`
- `POST /api/autonomy/mode`

Payload:
```json
{"mode":"standard"}
```
or
```json
{"mode":"relentless"}
```

## Provider Config + Discovery

- `GET /api/providers/config`
- `POST /api/providers/config`
- `POST /api/providers/import-openclaw`
- `GET /api/models?provider=ollama|openrouter|nvidia`

## Model Runtime

- `GET /api/model/current`
- `POST /api/model/switch`

Switch payload:
```json
{"provider":"ollama","model":"ollama/qwen3.5:397b-cloud"}
```

## Chat

- `POST /api/chat`

Payload:
```json
{"sessionId":"abc","message":"do X"}
```

Response includes:
- `reply`
- `replyHtml`
- `model`
- `trace` (iterations/tool calls/failures)

## Direct Tool Run

- `POST /api/tool/run`

Payload:
```json
{"name":"shell_run","args":{"cmd":"ls -la"}}
```

## Session History

- `GET /api/sessions/:sessionId`

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
