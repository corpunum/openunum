# Config Schema

Config path:
- default: `~/.openunum/openunum.json`
- override: `$OPENUNUM_HOME/openunum.json`

Secret store path:
- default: `~/.openunum/secrets.json`
- override: `$OPENUNUM_HOME/secrets.json`

## Schema (Current)

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 18880
  },
  "browser": {
    "cdpUrl": "http://127.0.0.1:9222",
    "fallbackEnabled": true
  },
  "runtime": {
    "maxToolIterations": 8,
    "shellEnabled": true,
    "executorRetryAttempts": 3,
    "executorRetryBackoffMs": 700,
    "providerRequestTimeoutMs": 120000,
    "agentTurnTimeoutMs": 420000,
    "autonomyMode": "standard",
    "missionDefaultContinueUntilDone": true,
    "missionDefaultHardStepCap": 120,
    "missionDefaultMaxRetries": 3,
    "missionDefaultIntervalMs": 400
  },
  "model": {
    "provider": "ollama",
    "model": "ollama/minimax-m2.7:cloud",
    "providerModels": {
      "ollama": "ollama/minimax-m2.7:cloud",
      "openrouter": "openrouter/openai/gpt-4o-mini",
      "nvidia": "nvidia/qwen/qwen3-coder-480b-a35b-instruct",
      "openai": "openai/gpt-4o-mini"
    },
    "routing": {
      "fallbackEnabled": true,
      "fallbackProviders": ["ollama", "nvidia", "openrouter", "openai"],
      "forcePrimaryProvider": false
    },
    "behaviorOverrides": {},
    "ollamaBaseUrl": "http://127.0.0.1:11434",
    "openrouterBaseUrl": "https://openrouter.ai/api/v1",
    "nvidiaBaseUrl": "https://integrate.api.nvidia.com/v1",
    "openaiBaseUrl": "https://api.openai.com/v1",
    "genericBaseUrl": "https://api.openai.com/v1",
    "openrouterApiKey": "",
    "nvidiaApiKey": "",
    "openaiApiKey": "",
    "genericApiKey": ""
  },
  "channels": {
    "telegram": {
      "botToken": "",
      "enabled": false
    }
  }
}
```

## Secret Store

Provider and integration credentials are stored separately from `openunum.json`:

```json
{
  "contract_version": "2026-04-01.secret-store.v1",
  "updated_at": "2026-04-01T12:00:00.000Z",
  "secrets": {
    "openrouterApiKey": "",
    "nvidiaApiKey": "",
    "openaiApiKey": "",
    "openaiOauthToken": "",
    "githubToken": "",
    "copilotGithubToken": "",
    "huggingfaceApiKey": "",
    "elevenlabsApiKey": "",
    "telegramBotToken": ""
  }
}
```

`secrets.json` is written with file mode `0600`.

## Notes

- `src/config.mjs` applies defaults with `withDefaults(...)` to keep backward compatibility.
- `src/config.mjs` migrates legacy provider and Telegram secrets out of `openunum.json` into `secrets.json` on load.
- `GET /api/config` returns sanitized config only; use `GET /api/providers/config` for `has*ApiKey` booleans and `GET /api/auth/catalog` for redacted auth status.
- `model.behaviorOverrides` can pin behavior classes/tuning per provider (`"ollama"`) or exact provider-model key (`"ollama::ollama/qwen3.5:9b-64k"`).
- Behavior overrides and learned behavior resets can be managed via:
  - `GET /api/controller/behavior-classes`
  - `POST /api/controller/behavior/override`
  - `POST /api/controller/behavior/override/remove`
  - `POST /api/controller/behavior/reset`
  - `POST /api/controller/behavior/reset-all`
- New fields should always be added to defaults + merged in `withDefaults(...)`.
- Runtime/API updates should call `agent.reloadTools()` when tool behavior may change.
