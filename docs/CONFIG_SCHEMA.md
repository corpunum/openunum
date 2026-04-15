# Config Schema

Config path:
- default: `~/.openunum/openunum.json`
- override root: `$OPENUNUM_HOME/openunum.json`

Secret store paths:
- plaintext: `~/.openunum/secrets.json`
- encrypted: `~/.openunum/secrets.enc.json`

## Current Example

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
    "autonomyMode": "autonomy-first",
    "missionDefaultContinueUntilDone": true,
    "missionDefaultHardStepCap": 120,
    "missionDefaultMaxRetries": 3,
    "missionDefaultIntervalMs": 400,
    "gitOverviewCacheTtlMs": 15000,
    "modelBackedTools": {
      "enabled": false,
      "exposeToController": true,
      "localMaxConcurrency": 1,
      "queueDepth": 8,
      "autoProfileTuningEnabled": true,
      "profileSwitchMinSamples": 6,
      "latencyWeight": 0.35,
      "costWeight": 0.25,
      "failurePenalty": 0.8,
      "recommendedLocalModels": [
        "gemma4:cpu",
        "nomic-embed-text:v1.5"
      ],
      "tools": {
        "summarize": { "backendProfiles": [] },
        "classify": { "backendProfiles": [] },
        "extract": { "backendProfiles": [] },
        "parse_function_args": { "backendProfiles": [] },
        "embed_text": { "backendProfiles": [] }
      }
    }
  },
  "model": {
    "provider": "ollama-cloud",
    "model": "ollama-cloud/qwen3.5:397b-cloud",
    "providerModels": {
      "ollama-local": "ollama-local/gemma4:cpu",
      "ollama-cloud": "ollama-cloud/qwen3.5:397b-cloud",
      "nvidia": "nvidia/qwen/qwen3-coder-480b-a35b-instruct",
      "openrouter": "openrouter/openai/gpt-4o-mini",
      "xiaomimimo": "xiaomimimo/gpt-4o-mini",
      "openai": "openai/gpt-4o-mini"
    },
    "routing": {
      "fallbackEnabled": true,
      "fallbackProviders": ["ollama-cloud", "nvidia", "openrouter", "xiaomimimo", "openai"],
      "forcePrimaryProvider": false
    },
    "behaviorOverrides": {},
    "ollamaBaseUrl": "http://127.0.0.1:11434",
    "openrouterBaseUrl": "https://openrouter.ai/api/v1",
    "nvidiaBaseUrl": "https://integrate.api.nvidia.com/v1",
    "xiaomimimoBaseUrl": "https://token-plan-ams.xiaomimimo.com/v1",
    "xiaomimimoAnthropicBaseUrl": "https://token-plan-ams.xiaomimimo.com/anthropic",
    "openaiBaseUrl": "https://api.openai.com/v1",
    "genericBaseUrl": "https://api.openai.com/v1"
  },
  "channels": {
    "telegram": {
      "botToken": "",
      "enabled": false
    }
  }
}
```

## Important Runtime Notes

- `GET /api/config` returns sanitized config only.
- Provider readiness and auth state live behind:
  - `GET /api/providers/config`
  - `GET /api/auth/catalog`
- Mission payload guardrails are enforced at request-validation time:
  - `maxSteps`: `1..120`
  - `hardStepCap`: `1..300`
  - `maxRetries`: `0..20`
- `autonomyMode` values are:
  - `autonomy-first`
  - `compact-local`
  - `relentless`
- `runtime.modelBackedTools.*` configures logical local-model-backed tools without changing the main controller/tool-call loop structure.

## Secret Backend

Optional encrypted backend:
- `OPENUNUM_SECRETS_BACKEND=passphrase`
- `OPENUNUM_SECRETS_PASSPHRASE=<strong passphrase>`

OpenUnum will write encrypted envelope data to `secrets.enc.json` and keep secret-bearing fields out of the main config file.
