# Changelog (Current Consolidated)

Date: 2026-03-30

## Major Additions

1. Menu-driven Web UI with center-panel view switching.
2. Chat execution trace visibility (expand/collapse) with in-flight typing animation.
3. Provider/model routing hardening and strict primary-provider mode.
4. Deterministic model identity responses from runtime state.
5. Browser launch diagnostics and managed CDP launch endpoint.
6. Autonomy mode presets API (`standard` / `relentless`).
7. Mission engine upgrades:
   - retry support
   - continue-until-done mode
   - hard cap control
   - proof-aware completion requirement
8. Persistent learning memory additions:
   - `tool_runs`
   - `strategy_outcomes`
9. ExecutorDaemon added for retry/backoff command/tool execution.
10. Direct download capability via `http_download` tool.
11. Chat reliability hardening:
   - UI request timeout + robust spinner cleanup
   - server pending-chat lifecycle (`/api/chat` 202 pending)
   - pending poll endpoint (`GET /api/chat/pending`)
   - session-route decode fix for history lookup
12. Runtime timeout controls:
   - `runtime.providerRequestTimeoutMs`
   - `runtime.agentTurnTimeoutMs`
13. Chat `/auto` mission command:
   - `/auto <goal>` starts mission execution from chat
   - auto-polls mission progress and posts final status in the same bubble
14. Agent anti-halt continuation:
   - if a turn has already executed tools and then emits planning-only text with no new tool calls,
     OpenUnum now forces up to two additional continuation passes before returning.

## Stability/Validation

- Full phase E2E suite passing (`phase0` to `phase7`) after each major upgrade pass.

## Architectural Direction

OpenUnum is now oriented around:
- evidence-backed autonomous execution
- durable memory for strategy reuse
- operator-facing transparency into tool behavior
