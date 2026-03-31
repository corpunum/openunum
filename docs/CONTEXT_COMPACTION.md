# Context Compaction

OpenUnum supports model-aware session compaction to keep long chats operational.

## Policy

- Trigger when estimated usage exceeds `runtime.contextCompactTriggerPct`.
- Compact older messages and keep recent turns intact (`runtime.contextProtectRecentTurns`).
- Target usage after compaction is `runtime.contextCompactTargetPct`.
- Hard-fail guard at `runtime.contextHardFailPct`.

## Preservation Rules

- Recent turns are never compacted.
- Older user prompts are preserved with light truncation.
- Older assistant/tool messages are compacted more aggressively.
- Compaction checkpoint summary is recorded and reused.

## Persistence

- `session_compactions` stores compaction checkpoints and token stats.
- `memory_artifacts` stores extracted constraints/failures/file refs.

## APIs

- `GET /api/context/status?sessionId=...`
- `POST /api/context/compact`
- `GET /api/context/compactions?sessionId=...`
- `GET /api/context/artifacts?sessionId=...`

