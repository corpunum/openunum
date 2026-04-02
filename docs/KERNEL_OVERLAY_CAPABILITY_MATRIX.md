# Kernel vs Overlay Capability Matrix

## Decision Rule

- `Kernel`: invariants that must remain stable across providers/models and across agent hot swaps.
- `Overlay`: agent/model-specific strategies that can diverge safely.

If breaking a capability risks data safety, replay correctness, API compatibility, or cross-agent onboarding, it belongs in the kernel.

## Current Matrix

1. Capability registry and discoverability
- Class: `Kernel`
- Status: `Implemented`
- Surfaces:
  - `GET /api/capabilities`
  - `GET /api/tools/catalog`

2. Transactional resource mutations
- Class: `Kernel`
- Status: `Implemented (sessions)`
- Surfaces:
  - `MemoryStore.deleteSession(...)`
  - `MemoryStore.clearSessions(...)`

3. Destructive action safeguards
- Class: `Kernel`
- Status: `Implemented (sessions)`
- Rules:
  - protect active session by default in tool runtime
  - require `keepSessionId` or `force=true` for full clear via API/tool

4. Idempotency/replay safety
- Class: `Kernel`
- Status: `Implemented (sessions)`
- Contract:
  - `operationId` supported for `session_clear` and `session_delete`
  - operation receipts persisted in `operation_receipts`

5. Error taxonomy contract
- Class: `Kernel`
- Status: `Implemented (API baseline)`
- Contract version: `2026-04-02.api-errors.v1`

6. Observability ledger for destructive ops
- Class: `Kernel`
- Status: `Implemented (baseline)`
- Surface:
  - `GET /api/operations/recent`

7. Provider/model execution profiles and safety policy
- Class: `Kernel`
- Status: `Implemented`
- Notes:
  - compact profile includes session management tools

8. Core resources and schemas (`session/message/tool_run/artifact`)
- Class: `Kernel`
- Status: `Implemented`

9. Agent-generated strategies, plans, workflows
- Class: `Overlay`
- Status: `Implemented`
- Surfaces:
  - slash commands, dynamic tool routing, mission planning

10. Agent/model-specific heuristics and behavior tuning
- Class: `Overlay`
- Status: `Implemented`
- Surfaces:
  - behavior registry overrides, provider routing heuristics

11. Generated helper skills/subfiles
- Class: `Overlay`
- Status: `Implemented with policy checks`

## Open Kernel Gaps (Next Priorities)

1. Expand idempotent contracts beyond sessions to all destructive resources.
2. Add operation rollback hooks beyond file backups (resource-aware undo).
3. Add structured error codes for all API endpoints (not only baseline/global paths).
4. Add promotion gates for overlay-generated code/assets before persistence.
5. Add compatibility checks for overlay packs during model/agent hot swaps.

## Practical Guidance

- Keep kernel small and explicit.
- Let overlays own strategy and implementation style.
- Never let overlays bypass kernel contracts for destructive operations.
