# Changelog (Current Consolidated)

Date: 2026-04-03

## Durability + Recovery + Benchmark Pass

0. Finished the remaining autonomy framework suggestions:
   - worker records now persist in SQLite and scheduled workers are rehydrated after restart
   - self-edit runs now persist in SQLite and in-flight runs are marked interrupted on boot
   - planner intent coverage expanded to `deploy`, `benchmark`, `sync`, `diagnose`, and `cleanup`
   - self-edit promotion is now blocked by path-aware policy gates when required validations/canaries are missing

1. Fixed the bootstrap ES module defect:
   - `bootstrap.mjs` no longer calls `require()` inside an ES module

2. Improved repo hygiene for local model/operator artifacts:
   - `.gitignore` now excludes `*.gguf`, `*.db`, and `tmp/`

3. Hardened execution-envelope semantics:
   - large-model tier detection now uses more precise token matching
   - compact-tier false positives like `397b` matching `7b` remain covered by regression
   - profile config can now disable implicit kernel-tool injection via `includeKernelTools: false`

4. Replaced the blocking disk-space check in legacy `selfheal.mjs`:
   - `df` is now executed through async `execFile`, not `execSync`

5. Added deterministic fallback summarization when tools succeed but the model fails to emit a final answer:
   - controller now attempts an evidence-based summary before falling back to a raw action dump
   - this directly covers sessions like model-search tasks where the tool results are sufficient but the model never returns a clean final response

6. Added new regression coverage:
   - `tests/phase27.worker-persistence.e2e.mjs`
   - `tests/phase28.self-edit-promotion-policy.e2e.mjs`

7. Added a machine-local benchmark/report update:
   - refreshed `local_models_report.md`
   - recorded live Ollama results for installed uncensored local models on the current AMD Z1 Extreme host

8. Fixed oversized tool-dump fallbacks in chat recovery:
   - added `src/core/turn-recovery-summary.mjs`
   - tool-only failures now produce bounded evidence-based summaries instead of raw multi-hundred-KB dumps
   - model-ranking questions now bias recovery output toward hardware-fit, not just popularity
   - added regression `tests/phase29.turn-recovery-summary.e2e.mjs`

9. Added weak-answer replacement and research/list comparison shaping:
   - synthesized recovery now supports research/dataset comparison answers, not just status/ranking fallbacks
   - weak non-empty replies are replaced when decisive evidence exists but the returned text is only a stub
   - controller prompt now instructs the model to choose final answer shape from the ask and evidence
   - added regression `tests/phase30.research-answer-shaping.e2e.mjs`

## WebUI Upgrade + Session Switching Fix + Docs Refresh

0. Updated flagship `src/ui/index.html` to a Gemini-inspired glass visual direction without dropping existing backend feature wiring.

1. Fixed chat session switching bug in WebUI:
   - pending run handling is now scoped per originating `sessionId`
   - pending polling uses request-scoped session targets instead of mutable global state
   - switching sessions during a pending run no longer cross-wires message/activity polling

2. Reduced menu label ambiguity and repetition:
   - standardized sidebar groups to `Chat`, `Missions`, `Runtime`, `Settings`
   - updated submenu/view labels (for example `Execution Trace`, `Provider Vault`, `Browser Ops`, `Control Plane API`)

3. Added OAuth-safe smoke coverage:
   - new script `scripts/ui-smoke-noauth.mjs`
   - new npm command `pnpm smoke:ui:noauth`
   - validates UI/API surfaces while intentionally avoiding OAuth launcher endpoints (`/api/service/connect`, `/api/auth/job/input`)

4. Completed server refactor checkpoint:
   - route handlers extracted under `src/server/routes/*.mjs`
   - runtime helpers extracted under `src/server/services/*.mjs`
   - `src/server.mjs` now acts as composition/distribution shell across route/service modules

Date: 2026-04-02

## Kernel/Overlay Contracts + Session Destruction Reliability

0. Added first-class session destruction primitives in kernel memory/API/tool layers:
   - new memory methods: `deleteSession`, `clearSessions`
   - new APIs: `POST /api/sessions/clear`, `DELETE /api/sessions/:sessionId`
   - new tools: `session_list`, `session_delete`, `session_clear`
   - compact execution profile allowlist now includes session tools for small-model portability

1. Added replay-safe idempotency for destructive session actions:
   - optional `operationId` contract for session clear/delete
   - new persisted receipt table `operation_receipts`
   - new API: `GET /api/operations/recent`

2. Added tool capability registry surface for dynamic onboarding:
   - capability payload upgraded to `2026-04-02.webui-capabilities.v2`
   - new API: `GET /api/tools/catalog`
   - capability payload now includes tool safety metadata and proof hints

3. Added baseline structured API error contract:
   - contract version: `2026-04-02.api-errors.v1`
   - standardized error shape for not-found, invalid-json, and internal errors

4. Added architecture docs for kernel vs overlay autonomy:
   - new docs: `docs/KERNEL_OVERLAY_CAPABILITY_MATRIX.md`
   - new docs: `docs/AUTONOMY_PACKS.md`

## Adaptive Reliability + Operator Controls

0. Removed runtime-specific hardcoded recovery and generalized mission adaptation:
   - stalled missions now enforce route pivoting by execution surface instead of banning specific runtimes
   - repeated multi-surface failures now trigger explicit web-research fallback guidance for alternative routes
   - recovery directive now records changed-attempt requirement before retry

1. Added persistent route-signature learning loop:
   - new `route_lessons` persistence in SQLite
   - mission runner now records per-route success/failure signatures from tool deltas each turn
   - runtime hints now include historical route guidance (known failing routes, known reliable routes)
   - route lessons are now included in memory knowledge search

2. Added manual controller-behavior controls to avoid silent throttling from misclassification:
   - new `GET /api/controller/behavior-classes`
   - new `POST /api/controller/behavior/override`
   - new `POST /api/controller/behavior/override/remove`
   - new `POST /api/controller/behavior/reset`
   - new `POST /api/controller/behavior/reset-all`
   - learned behavior reset now clears both runtime in-memory state and persisted SQLite rows

3. Hardened Ollama provider not-found recovery:
   - when a configured Ollama model is missing, provider now discovers local tags and retries with a best-fit fallback model
   - fallback retry failures are now surfaced explicitly for deterministic recovery decisions

4. Fixed mission contract false-negatives for local runtime proof:
   - local proof detection now recognizes successful `http_request` verification against local runtime APIs (`/api/generate`, `/api/chat`)
   - missions with valid API proof now complete cleanly instead of looping on `missing_local_runtime_proof`

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

3. Upgraded agent onboarding docs for faster operator bring-up:
   - rewrote `docs/AGENT_ONBOARDING.md` with a 15-minute boot sequence
   - corrected credential verification flow to provider/auth endpoints
   - added mission/controller troubleshooting first-check sequence

4. Added competitive teardown reference from provided Claw Code source archive:
   - new `docs/COMPETITIVE_ANALYSIS_CLAW_CODE.md`
   - captures concrete deltas in prompt packing, tool-call translation, retry policy, hook pipeline, and bounded sub-agent execution

5. Added competitive teardown reference for OpenAI Codex source:
   - new `docs/COMPETITIVE_ANALYSIS_OPENAI_CODEX.md`
   - captures concrete deltas in policy engine shape, session recovery contracts, hook payload normalization, and fail-then-continue reliability testing

6. Added competitive teardown reference for Google Gemini CLI source:
   - new `docs/COMPETITIVE_ANALYSIS_GEMINI_CLI.md`
   - captures concrete deltas in scheduler state orchestration, mode-aware policy engine, plan-mode restrictions, hook interception, and failure-class fallback handling

7. Added consolidated controller roadmap:
   - new `docs/OPENUNUM_MULTI_MODEL_CONTROLLER_ACTION_PLAN.md`
   - merges Claw/Codex/Gemini reliability patterns into a phased OpenUnum implementation sequence with acceptance gates and a cross-provider test matrix

8. Added model-execution envelope enforcement for lightweight-model reliability:
   - new `src/core/model-execution-envelope.mjs`
   - runtime now infers `compact`/`balanced`/`full` execution tier per active provider/model
   - compact tiers can receive backend-enforced tool allowlists and lower turn iteration budgets
   - context-history fetch in agent loop now scales by execution envelope (`maxHistoryMessages`)

9. Hardened backend tool gating for profile-aware operation:
   - `src/tools/runtime.mjs` now supports tool-schema filtering by allowlist
   - tool execution now returns explicit `model_profile_tool_restricted` when an out-of-profile tool is called
   - controller passes per-turn allowed tool set into runtime execution context

10. Improved frontend/backend dynamic wiring for provider/model control:
   - capabilities payload now exposes dynamic provider order and auth-service ids
   - WebUI now hydrates provider and service lists from runtime capabilities/catalog instead of static arrays
   - fallback model handling now strips provider prefixes dynamically (no hardcoded provider regex dependency)
   - runtime overview now surfaces active execution envelope tier and limits

11. Added autonomous execution-policy engine with self-preservation defaults:
   - new `src/core/execution-policy-engine.mjs`
   - centralized policy decisions now support `plan` vs `execute` mode without requiring human approval prompts
   - shell self-destruct patterns are blocked by policy (`pkill/killall openunum/node`, `systemctl stop openunum`, hard reset/clean patterns, destructive repo wipe forms)

12. Added local restoration path for self-modifying file operations:
   - `file_write` and `file_patch` now create local backups in `~/.openunum/backups`
   - new tool `file_restore_last` restores the latest backup (optionally by path)

13. Added typed provider-failure classification and deterministic fallback actions:
   - new `src/core/provider-fallback-policy.mjs`
   - failures are now classified (`timeout`, `network`, `auth`, `not_found`, `quota`, `rate_limited`, `unknown`)
   - controller uses per-class policy (`retry_same_provider` vs `switch_provider` with cooldown)
   - provider cooldown state is tracked in-agent to avoid route thrashing

14. Exposed provider availability/cooldown status in runtime overview:
   - `/api/runtime/overview` now includes `providerAvailability`
   - WebUI runtime summary now surfaces provider cooldown/failure-kind metadata

15. Added explicit mission completion contracts with autonomous enforcement:
   - missions now infer a contract (`local-runtime-proof-v1`, `coding-proof-v1`, or `generic-proof-v1`)
   - `MISSION_STATUS: DONE` is accepted only when contract proof/checkpoint requirements pass
   - contract violations are recorded in mission logs and status payloads

16. Added autonomous rollback strategy when proof/contract failures repeat:
   - repeated DONE-without-contract-proof now triggers one automatic `file_restore_last` attempt
   - rollback result and attempt count are persisted in mission timeline/status metadata

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

## 2026-04-03 Generic Autonomy Upgrade

1. Planner-backed generic task framework:
   - added `GoalTaskPlanner` for plain-language goal compilation
   - added `TaskOrchestrator` for reusable step execution, verification, and monitoring
   - new APIs:
     - `POST /api/autonomy/tasks/plan`
     - `GET /api/autonomy/tasks`
     - `GET /api/autonomy/tasks/status`
     - `POST /api/autonomy/tasks/run`
2. Restart-safe task persistence:
   - SQLite tables:
     - `task_records`
     - `task_step_results`
     - `task_check_results`
   - running tasks are marked `interrupted` after restart instead of disappearing
3. Planner-backed chat `/auto`:
   - `/auto <goal>` now launches a generic task, not a hardcoded single mission step
   - preflight evidence and mission execution can share one session id
4. New autonomy components:
   - `worker-orchestrator`
   - `self-edit-pipeline`
   - `model-scout-workflow`
   - `autonomy-registry`
5. Runtime/autonomy docs updated:
   - onboarding
   - codebase map
   - UI behavior
   - API reference
6. Execution-envelope classifier fix:
   - `397b`/large cloud models no longer misclassify as compact due to substring matches such as `7b` inside `397b`
