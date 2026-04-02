# Competitive Analysis: OpenAI Codex (Reliability/Control Patterns)

Date: 2026-04-02
Source commit analyzed: `c1d18ceb6` (`/tmp/openai-codex`)

Scope:
- Identify reliability and control patterns in Codex CLI that are directly transferable to OpenUnum's mission/controller architecture.

## 1. What Codex Is Doing Better (From Source)

### 1.1 Approval/policy is treated as a first-class execution subsystem

Codex uses a dedicated exec-policy layer with:
- structured policy loading/parsing
- rule-level prompt/deny semantics
- safe amendment flows
- explicit conflict handling when approval mode and policy disagree

Reference files:
- `codex-rs/core/src/exec_policy.rs`
- `codex-rs/core/src/config/permissions.rs`

Impact:
- policy decisions are deterministic and inspectable
- approval behavior is consistent across tools/providers

### 1.2 Recovery is explicit for session/transport edge cases

Codex RMCP client performs guarded recovery when streamable HTTP session expires (404 session-expired), including:
- lock-guarded reinitialization
- single recovery path
- retrying operation after recovery
- handshake/service timeouts with typed errors

Reference file:
- `codex-rs/rmcp-client/src/rmcp_client.rs`

Impact:
- avoids deadlocked tool loops after transient transport/session failures
- ensures failures become explicit state transitions

### 1.3 Hook payloads are structured and telemetry-friendly

Codex hook payloads include stable structured fields for:
- tool kind
- tool input details
- execution success/failure
- duration
- sandbox policy and execution context

Reference file:
- `codex-rs/hooks/src/types.rs`

Impact:
- policy and runtime introspection can be automated
- easier postmortem classification across model/provider combinations

### 1.4 Turn lifecycle is strongly serialized

Regular task loop explicitly emits turn-start state and processes additional pending input in a controlled loop.

Reference file:
- `codex-rs/core/src/tasks/regular.rs`

Impact:
- lowers risk of "half-finished turn" UI/controller ambiguity

### 1.5 Fail-and-continue behavior is validated in tests

Codex contains dedicated tests ensuring stream errors do not poison next turns.

Reference files:
- `codex-rs/core/tests/suite/stream_error_allows_next_turn.rs`
- `codex-rs/core/tests/suite/approvals.rs`

Impact:
- reliability assumptions are continuously enforced, not informal.

## 2. Concrete Gaps In OpenUnum (Relative)

1. Mission/controller failures are tracked, but policy and transport recovery logic remain less centralized than Codex.
2. Hook metadata is available but not yet as normalized for cross-provider replay/analytics.
3. Approval/rule amendments are less unified as a single execution-policy engine.
4. Recovery contracts for transport/session edge cases need stronger typed paths and test fixtures.

## 3. Transferable Deltas For OpenUnum

1. Build a provider-generic `ExecutionPolicyEngine`:
- canonical rule model (allow/prompt/deny)
- explicit approval-mode conflict resolution
- append-only amend log and deterministic replay

2. Add transport/session recovery contracts:
- classify failures (`session_expired`, `transient_io`, `auth`, `not_found`)
- per-class recovery actions
- guarded single-path re-init to avoid duplicate recoveries

3. Normalize hook telemetry schema:
- stable envelope for pre/post tool events
- include timing, provider, sandbox, mutation flags
- attach to mission timeline and `/api/controller/behaviors`

4. Expand reliability tests:
- "stream error then next turn succeeds"
- "approval denied/accepted updates future behavior"
- "recovery path fires once and returns deterministic mission state"

## 4. Why This Matters For Multi-Provider OpenUnum

OpenUnum's challenge is heterogeneity (Ollama/NVIDIA/OpenRouter/OpenAI + local runtimes). Codex-style policy and recovery discipline reduces provider-specific drift by enforcing one deterministic control plane above all transports.

## 5. Source References Used

- `/tmp/openai-codex/codex-rs/core/src/exec_policy.rs`
- `/tmp/openai-codex/codex-rs/core/src/config/permissions.rs`
- `/tmp/openai-codex/codex-rs/rmcp-client/src/rmcp_client.rs`
- `/tmp/openai-codex/codex-rs/hooks/src/types.rs`
- `/tmp/openai-codex/codex-rs/core/src/tasks/regular.rs`
- `/tmp/openai-codex/codex-rs/core/tests/suite/approvals.rs`
- `/tmp/openai-codex/codex-rs/core/tests/suite/stream_error_allows_next_turn.rs`
