# Autonomy and Memory

This document explains how OpenUnum persists, retries, and learns.

## 1. Autonomy Controls

### Runtime knobs

Stored in `config.runtime`:
- `maxToolIterations`
- `shellEnabled`
- `executorRetryAttempts`
- `executorRetryBackoffMs`
- `autonomyMode`
- `missionDefaultContinueUntilDone`
- `missionDefaultHardStepCap`
- `missionDefaultMaxRetries`
- `missionDefaultIntervalMs`

### Routing knobs

Stored in `config.model.routing`:
- `forcePrimaryProvider`
- `fallbackEnabled`
- `fallbackProviders`

## 2. Autonomy Presets

Endpoint: `POST /api/autonomy/mode`

### `standard`

- moderate retries
- standard loop limits
- keeps existing strict/fallback routing decisions unless missing fallback list

### `relentless`

- raises tool loop and executor retries
- reduces mission interval
- increases mission retry and hard cap limits
- forces strict primary-provider route (`forcePrimaryProvider=true`, fallback disabled)

## 3. Mission Proof Logic

Mission runner (`src/core/missions.mjs`) does not trust text-only completion.

For each step:
- capture successful tool-run count before step
- run agent step
- capture successful tool-run count after step
- treat as evidence only if successful count increased

If model says `MISSION_STATUS: DONE` without proof:
- mission increments retry counter
- records failure strategy outcome
- continues until retry budget is exhausted

## 4. Persistence Model (SQLite)

DB file: `~/.openunum/openunum.db`

### Tables

- `sessions`: chat/session identity
- `messages`: chronological user/assistant messages
- `facts`: user-remembered facts
- `tool_runs`: every tool invocation with args/result + success flag
- `strategy_outcomes`: success/failure outcomes linked to goal/strategy

## 5. Strategy Reuse

Before each chat run, agent retrieves recent strategy outcomes for related goals and injects them into system guidance.

Effect:
- biases toward previously successful approaches
- warns against recently failing approaches
- improves autonomous retry quality over time

## 6. Executor Behavior

`ExecutorDaemon` (`src/tools/executor-daemon.mjs`) wraps critical operations with:
- retry attempts
- incremental backoff
- per-attempt JSONL logging

Log file:
- `~/.openunum/logs/executor.jsonl`

## 7. Tool Trace in Chat

Chat API returns structured `trace`:
- provider/model used
- iterations
- tool calls per iteration
- summarized tool results
- provider failure chain if all attempts fail

UI renders trace as expandable/collapsible panel beneath each assistant response.

## 8. Practical Tuning

For maximum persistence:
- set autonomy mode to `relentless`
- keep `shellEnabled=true`
- use strict provider lock if model consistency is critical
- increase mission `hardStepCap` for long workflows
