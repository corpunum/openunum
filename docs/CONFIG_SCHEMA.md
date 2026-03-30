# Config Schema

Config path:
- default: `~/.openunum/openunum.json`
- override: `$OPENUNUM_HOME/openunum.json`

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
      "generic": "generic/gpt-4o-mini"
    },
    "routing": {
      "fallbackEnabled": true,
      "fallbackProviders": ["ollama", "nvidia", "openrouter", "generic"],
      "forcePrimaryProvider": false
    },
    "ollamaBaseUrl": "http://127.0.0.1:11434",
    "openrouterBaseUrl": "https://openrouter.ai/api/v1",
    "nvidiaBaseUrl": "https://integrate.api.nvidia.com/v1",
    "genericBaseUrl": "",
    "openrouterApiKey": "",
    "nvidiaApiKey": "",
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

## Notes

- `src/config.mjs` applies defaults with `withDefaults(...)` to keep backward compatibility.
- New fields should always be added to defaults + merged in `withDefaults(...)`.
- Runtime/API updates should call `agent.reloadTools()` when tool behavior may change.
