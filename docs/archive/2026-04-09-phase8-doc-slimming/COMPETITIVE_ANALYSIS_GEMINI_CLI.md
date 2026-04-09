# Competitive Analysis: Google Gemini CLI (Scheduler/Policy/Fallback Patterns)

Date: 2026-04-02
Source commit analyzed: `242afd49a` (`/tmp/gemini-cli`)

Scope:
- Identify why Gemini CLI remains stable across long tool loops and model failures, and extract provider-generic upgrades for OpenUnum.

## 1. What Gemini CLI Is Doing Better (From Source)

### 1.1 Tool execution is orchestrated by an explicit scheduler state machine

Gemini separates scheduling/state from execution:
- queue and active-call lifecycle tracking
- explicit terminal vs non-terminal states
- cancellation propagation across queued and active work
- publish-on-change tool-call state snapshots

Reference files:
- `packages/core/src/scheduler/scheduler.ts`
- `packages/core/src/scheduler/state-manager.ts`

Impact:
- prevents hidden/implicit tool-loop behavior
- improves determinism when calls overlap, cancel, or tail-chain

### 1.2 Policy engine is rule-based with mode/subagent awareness

Gemini policy evaluation includes:
- prioritized rules and checkers
- wildcard + MCP-server scoping
- approval mode gating (`default`, `autoEdit`, `plan`, etc.)
- subagent-specific rule matching
- non-interactive safeguards

Reference files:
- `packages/core/src/policy/policy-engine.ts`
- `packages/core/src/scheduler/policy.ts`

Impact:
- one policy plane controls all tool behavior
- different execution modes stay predictable instead of ad-hoc

### 1.3 Plan mode has hard tool restrictions

Gemini plan mode enforces read-focused tool allowlists and constrained write scope for plan artifacts.

Reference file:
- `docs/cli/plan-mode.md`

Impact:
- separates exploration/planning from mutating execution
- lowers accidental destructive operations when models are uncertain

### 1.4 Hook system is integrated into tool execution path

Gemini runs pre/post tool hooks that can:
- block tool execution
- mutate tool arguments (with validation)
- add context
- request stop-execution behavior
- request tail tool calls

Reference file:
- `packages/core/src/core/coreToolHookTriggers.ts`

Impact:
- adds strong interception points for guardrails and self-correction

### 1.5 Fallback and availability are policy-driven, not ad-hoc retries

Gemini classifies failure kinds and resolves fallback through model-policy chains with availability transitions.

Reference files:
- `packages/core/src/fallback/handler.ts`
- `packages/core/src/availability/errorClassification.ts`
- `packages/core/src/availability/policyHelpers.ts`

Impact:
- avoids random provider/model hopping
- creates consistent fallback behavior under quota/not-found/transient errors

### 1.6 Prompt system is layered and model-aware

Gemini composes prompts from sections, skills, mode state, tool registry state, and optional environment overrides.

Reference file:
- `packages/core/src/prompts/promptProvider.ts`

Impact:
- model receives stable contracts tailored to mode and capability
- reduces drift across model families

## 2. Concrete Gaps In OpenUnum (Relative)

1. OpenUnum mission flow is robust, but tool execution state transitions are less explicit than Gemini's scheduler model.
2. Plan/execution mode separation is weaker; planning and mutation can blend in one loop.
3. Fallback behavior exists but needs stronger failure-kind taxonomy and policy-chain semantics across all providers.
4. Hook system can be expanded to include standardized stop/block/mutate contracts and tail-call chaining.

## 3. Transferable Deltas For OpenUnum

1. Introduce explicit scheduler state model:
- `scheduled -> validating -> awaiting_approval -> executing -> terminal`
- unify mission timeline and trace around these states

2. Add mode-aware policy layer:
- rule priorities, wildcard matching, subagent scoping
- shared semantics across providers (Ollama/NVIDIA/OpenRouter/OpenAI/local)

3. Implement plan-only mission mode:
- read-only tool allowlist
- structured implementation plan artifact
- explicit operator approval to switch into execution mode

4. Normalize hook contracts:
- pre-hook: allow/block/mutate/stop
- post-hook: allow/block/context/tail-call/stop
- include hook outcomes in mission evidence and behavior learning

5. Upgrade fallback engine:
- classify failures (`transient`, `terminal`, `not_found`, `auth`, `unknown`)
- resolve fallback with policy chain and provider constraints
- mark model availability state with TTL-based recovery

## 4. Why This Matters For Your Qwen/Ollama Scenario

For local-model setup missions (e.g., "choose runtime and launch best for hardware"), scheduler + policy + fallback discipline prevents the model from stalling in noisy exploration loops and increases chance of converging on a complete, evidence-backed setup.

## 5. Source References Used

- `/tmp/gemini-cli/packages/core/src/scheduler/scheduler.ts`
- `/tmp/gemini-cli/packages/core/src/scheduler/state-manager.ts`
- `/tmp/gemini-cli/packages/core/src/scheduler/policy.ts`
- `/tmp/gemini-cli/packages/core/src/policy/policy-engine.ts`
- `/tmp/gemini-cli/packages/core/src/core/coreToolHookTriggers.ts`
- `/tmp/gemini-cli/packages/core/src/fallback/handler.ts`
- `/tmp/gemini-cli/packages/core/src/availability/errorClassification.ts`
- `/tmp/gemini-cli/packages/core/src/availability/policyHelpers.ts`
- `/tmp/gemini-cli/packages/core/src/prompts/promptProvider.ts`
- `/tmp/gemini-cli/docs/cli/plan-mode.md`
