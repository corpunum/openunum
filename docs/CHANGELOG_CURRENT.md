# Changelog (Current Consolidated)

Date: 2026-04-02

## Reliability + Docs Clarification Pass

0. Hardened mission lifecycle against long-hanging controller turns:
   - added per-mission-step watchdog timeout around mission `agent.chat()` execution
   - timeout failures now terminate mission turns with explicit error evidence instead of indefinite `running/stopping` stalls
   - local-runtime cloud-controller missions now carry explicit mission turn timeout tuning

1. Hardened local-runtime recovery across providers:
   - recovery logic now detects provider/auth/model-not-found failure signals from mission replies
   - local-runtime missions can pivot controller back to configured Ollama model when non-Ollama provider path is failing

2. Updated operator docs to remove credential-source ambiguity:
   - clarified that `GET /api/config` is sanitized and cannot be used as key-presence truth source
   - documented `GET /api/providers/config` as readiness surface (`has*ApiKey`)
   - documented `GET /api/auth/catalog` as redacted auth/source surface
   - documented `POST /api/auth/prefill-local` as local secret scan/import path

Date: 2026-04-01

## Current Flagship Pass

0. Added model-aware controller scaffolding for cross-provider execution:
   - new behavior class registry in `src/core/model-behavior-registry.mjs`
   - new class-aware context pack builder in `src/core/context-pack-builder.mjs`
   - new execution contract helpers in `src/core/execution-contract.mjs`
   - provider turns now emit behavior metadata in trace (`behaviorClass`, `behaviorConfidence`, `behaviorSource`)
   - controller now enforces proof-backed completion and planner-without-execution continuation
   - learned behavior-class assignments now persist in SQLite (`controller_behaviors`) and are rehydrated on startup
   - added `GET /api/controller/behaviors` for operator inspection of in-memory vs persisted behavior state
   - behavior tuning now only tightens (never loosens) base execution profile budgets
   - local-runtime missions on Ollama cloud controllers now clamp provider/turn budgets and iteration caps during mission execution, then restore baseline runtime settings afterward
   - config now supports optional `model.behaviorOverrides`
   - added implementation guide: `docs/MODEL_AWARE_CONTROLLER.md`

1. Hardened local-runtime mission execution and provider portability:
   - tool/runtime turn budget enforcement now covers slow tool routes and nonproductive retries
   - deterministic shell syntax/usage failures stop retrying early
   - local-runtime missions detect prior proof and can complete from verified runtime output
   - bounded `http_request` path is now preferred for API verification, including shell-to-API curl rewrites
   - bad Ollama CLI forms (`invoke`, unsupported `run` flags) now produce explicit recovery steering instead of repeated dead-end attempts
   - NVIDIA full model ids are normalized correctly for OpenAI-compatible transport
   - local aggressive Qwen models now have explicit 16k context hints, with validation documenting that they still cannot serve as controllers over current Ollama tool-calling transport

2. Added `GET /api/capabilities` for capability-driven WebUI wiring.
3. Added `GET /api/model-catalog` with canonical provider order:
   - `ollama`
   - `nvidia`
   - `openrouter`
   - `openai`
4. Normalized legacy `generic` provider state to canonical `openai` while preserving read compatibility.
5. Upgraded `/api/config` to include:
   - `capabilities`
   - `modelCatalog`
   - `providerConfig`
6. Upgraded `/api/providers/config` to expose `openaiBaseUrl` and `hasOpenaiApiKey`, with legacy `generic*` aliases preserved.
7. Standardized WebUI shell markers for the cross-repo contract:
   - stable status bar
   - session search
   - provider/model/fallback/autonomy controls
   - trace panel
   - iMessage-style chat area selectors
7. Added `openunum` contract tests:
   - `tests/phase10.e2e.mjs`
   - `tests/phase11.e2e.mjs`
8. Reset the live flagship runtime on `127.0.0.1:18880` back to `autonomy-first`.
9. Harvested flagship features from the other products into `openunum`:
   - OpenBat-style quick prompts and operator-friendly control surface
   - Gemini-style browser telemetry/runtime cards
   - Qwen-style Git/runtime visibility
   - Codex/Claude-style provider health summary cards
10. Added donor-inspired execution logic improvements after reviewing `OpenBat/source`:
   - heuristic tool routing hints injected before model execution
   - first-class permission denial tracking in execution trace
   - explicit per-turn trace summaries for tool runs / iterations / denials
11. Added operator-grade context/session controls to the flagship WebUI:
   - session export via `GET /api/sessions/:sessionId/export`
   - explicit context budget telemetry from `GET /api/context/status`
   - one-click context compaction from the operator runtime view
12. Added a tactical ledger and pivot surface after deeper donor review:
   - `GET /api/autonomy/insights` to expose recent strategy outcomes, tool reliability, recent tool runs, and compactions
   - operator-side tactical ledger panel in the WebUI
   - per-turn `pivotHints` in execution trace based on denials, repeated tool failures, timeouts, and provider collapse
   - new `/ledger` slash command for quick operator summaries
13. Added replay import and filtered mission timeline tooling:
   - `POST /api/sessions/import` for session replay import
   - `POST /api/sessions/clone` for branchable replay from existing sessions
   - `GET /api/missions/timeline` for merged mission/operator playback
   - mission timeline filter/search controls in the WebUI
   - artifact drill-down from mission timeline into operator output
   - direct mission-session open/clone controls from the timeline
14. Added a secure provider/auth console pass to the flagship:
   - provider matrix table with endpoint, auth readiness, model count, and top-model visibility
   - secure auth vault for provider and adjacent integration credentials
   - redacted auth method table for GitHub, Google Workspace, HuggingFace, ElevenLabs, Telegram, OpenAI OAuth, and GitHub Copilot
15. Added secure secret persistence outside `openunum.json`:
   - new `~/.openunum/secrets.json` store written with mode `0600`
   - legacy provider/Telegram secrets are migrated out of config on load
   - `GET /api/config` is now sanitized and no longer returns raw secrets
16. Added new provider/auth endpoints:
   - `GET /api/auth/catalog`
   - `POST /api/auth/catalog`
   - `POST /api/auth/prefill-local`
17. Expanded local auth discovery beyond the old OpenClaw importer:
   - scans OpenClaw/OpenUnum-adjacent env files and runtime secret files
   - imports OpenAI, GitHub, HuggingFace, ElevenLabs, and Telegram secrets when present
   - exposes GitHub CLI / Google Cloud / HuggingFace CLI / ElevenLabs CLI availability as redacted UI state
18. Expanded flagship tests to verify:
   - secure secret persistence and scrubbed config writes
   - auth catalog contract
   - provider matrix and auth vault WebUI markers
19. Simplified the provider UX after operator review:
   - split the screen into compact `Model Providers` and `Service Providers` tables
   - reduced default row content to status, auth, summary, and action
   - moved endpoint/discovery details behind per-row `Advanced` toggles
   - added row hide/add controls to keep the default screen smaller
20. Simplified model routing:
   - retained all four providers in the shared catalog
   - replaced fallback profiles with an explicit ordered fallback sequence editor
   - primary provider/model selection now sits above a concrete per-provider fallback list
21. Added row-level test/connect actions:
   - `POST /api/provider/test`
   - `POST /api/service/test`
   - `POST /api/service/connect`
   - service OAuth kick-off supports GitHub CLI plus native `openunum` browser flows for OpenAI Codex and Google Workspace
22. Fixed service OAuth flows in the flagship Providers screen:
   - `openai-oauth` now discovers and reuses existing OpenClaw Codex OAuth profiles from `~/.openclaw/agents/*/agent/auth-profiles.json`
   - `openai-oauth` `Connect` now starts a native `openunum` OAuth job with browser/callback handling and optional manual code paste fallback
   - native OpenAI OAuth credentials are now persisted in `~/.openunum/secrets.json` under `oauth.openaiCodex`
   - `google-workspace` now saves native Google OAuth client config in `~/.openunum/secrets.json` and starts a browser/callback PKCE flow without `gcloud`
   - the Providers UI now exposes `Connect` for OpenAI OAuth in the same row-level action model as the other OAuth-capable services
23. Aligned auth and provider state for OpenAI OAuth:
   - `GET /api/auth/job` and `POST /api/auth/job/input` added for browser-driven OAuth orchestration
   - OpenAI provider auth readiness now recognizes native/compat OpenAI Codex OAuth even when no OpenAI API key is configured
   - OpenAI model catalog stays available from seeded policy models while OAuth is present
24. Wired native OpenAI Codex OAuth into actual model execution:
   - added `src/providers/openai-codex-oauth.mjs`
   - `openai` provider selection now prefers Codex OAuth transport for GPT-5 and Codex-family OpenAI models
   - non-Codex OpenAI models still use API-key `/chat/completions` when an API key is configured
   - provider loop now preserves assistant tool-call metadata between tool iterations so Codex tool continuation works correctly
   - added `tests/phase12.openai-codex-provider.e2e.mjs`
25. Expanded seeded OpenAI catalog coverage for OAuth-capable model routing:
   - `gpt-5.4-pro`
   - `gpt-5.4`
   - `gpt-5.4-mini`
   - `gpt-5.4-nano`
   - `gpt-5.3-codex`
   - `gpt-5.3-codex-spark`
26. Replaced the old Google Workspace CLI dependency with native `openunum` Google OAuth and API calls:
   - added `src/oauth/google-workspace.mjs`
   - `src/tools/google-workspace.mjs` now refreshes Google tokens and calls Gmail/Google APIs directly
   - Providers -> Google Workspace now saves client ID, optional client secret, and scopes through `/api/auth/catalog`
   - added `tests/phase13.google-workspace-native.e2e.mjs`
27. Hardened the Google Workspace OAuth UX:
   - `Connect` now auto-saves the current Google row before starting OAuth
   - blank secret inputs no longer wipe the stored Google client secret
   - malformed Google client IDs are rejected locally before the browser opens
   - downloaded Google OAuth JSON can be pasted directly and is normalized into client credentials

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
15. Default auto-escalation from chat:
   - new `Auto: On/Off` toggle in chat header (default ON, persisted in localStorage)
   - when enabled, planning-style non-final replies are auto-promoted to mission `/auto` continuation.
16. Live background activity visibility during typing:
   - new `Live: On/Off` toggle in chat header (default ON)
   - pending chat bubbles now show expandable live tool calls/results
   - new API endpoint: `GET /api/sessions/:sessionId/activity?since=...`
17. Request timeout hardening:
   - UI chat timeout increased and now auto-falls back to pending/live mode on timeout
   - `/api/chat` now returns `pending` quickly (20s window) for long-running turns
18. `/auto` mission resilience:
   - when mission polling returns `mission_not_found` (e.g., runtime restart),
     chat now auto-restarts the mission up to 2 times instead of stopping immediately.
19. Try-by-try visibility in chat bubble:
   - pending and `/auto` flows now record background attempts/retries/events in an expandable
     "Attempts & Retries" panel within the active assistant bubble.
20. Status-check auto-resume:
   - messages like `are you done?` no longer dead-end on planning replies.
   - if planning is detected, OpenUnum resumes `/auto` with the last actionable user task prompt.

## Stability/Validation

- Full phase E2E suite passing (`phase0` to `phase7`) after each major upgrade pass.

## Architectural Direction

OpenUnum is now oriented around:
- evidence-backed autonomous execution
- durable memory for strategy reuse
- operator-facing transparency into tool behavior
