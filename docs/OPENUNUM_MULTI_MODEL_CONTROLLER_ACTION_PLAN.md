# OpenUnum Multi-Model Controller Action Plan

Date: 2026-04-02

Goal:
- Make OpenUnum reliably complete missions across heterogeneous providers/models (Ollama, NVIDIA, OpenRouter, OpenAI, local runtimes) with minimal halting, strong self-correction, and deterministic recovery.

Inputs consolidated:
- `docs/COMPETITIVE_ANALYSIS_CLAW_CODE.md`
- `docs/COMPETITIVE_ANALYSIS_OPENAI_CODEX.md`
- `docs/COMPETITIVE_ANALYSIS_GEMINI_CLI.md`

## 1. Design Principles (Global)

1. One canonical control plane above all providers:
- one message/tool-call state model
- one policy/approval system
- one fallback taxonomy
- provider adapters only translate payloads/stream events

2. Separate planning from mutation:
- default mission starts in plan-capable state
- explicit transition into execution state
- stop planning loops from masquerading as progress

3. Enforce completion by evidence, not narrative:
- done only when proof contract is satisfied
- completion schema per mission type

4. Prefer typed recovery over generic retry:
- classify failure kinds first
- apply deterministic action per class

## 2. Target Architecture Changes

### 2.1 Unified Scheduler State Machine

Adopt explicit tool-turn lifecycle states:
- `scheduled`
- `validating`
- `awaiting_approval`
- `executing`
- `success | error | cancelled`

Required outcomes:
- mission timeline shows state transitions per tool call
- cancellation and timeout semantics are deterministic

### 2.2 Provider-Generic Adapter Layer

Implement a strict canonical internal protocol and per-provider translators for:
- tool definitions
- tool-choice semantics
- streaming tool-call argument assembly
- finish-reason normalization

Required outcomes:
- same mission prompt/tool plan behaves similarly across providers
- provider quirks are isolated in adapter tests

### 2.3 Execution Policy Engine

Create a centralized policy engine with:
- prioritized rules (`allow`, `prompt`, `deny`)
- wildcard and provider/subagent scoping
- mode gating (`plan`, `execute`, optional `yolo`)
- append-only rule amendment log

Required outcomes:
- no ad-hoc per-tool approval logic
- operator can inspect why each decision happened

### 2.4 Plan Mode + Execution Mode Split

Plan mode:
- read-only tools + structured planning output
- bounded research/subagent tools
- no mutating commands except plan artifact updates

Execution mode:
- mutating tools allowed by policy
- explicit budgets and completion checks

Required outcomes:
- fewer runaway edit loops
- better operator control before mutation starts

### 2.5 Hook Contract Standardization

Pre-hook actions:
- `allow`, `block`, `mutate_input`, `stop_execution`

Post-hook actions:
- `allow`, `block_result`, `add_context`, `tail_tool_call`, `stop_execution`

Required outcomes:
- guardrails can intercept consistently regardless of provider
- hook outcomes become training signals for behavior registry

### 2.6 Failure Taxonomy + Fallback Policy Chain

Failure classes:
- `transient`
- `terminal` (quota/billing)
- `not_found`
- `auth`
- `session_expired`
- `unknown`

Fallback chain policy:
- provider/model ordered candidates
- action per failure class (`silent_retry`, `prompt`, `hard_fail`)
- availability state with TTL backoff and re-entry

Required outcomes:
- no random provider hopping
- reproducible fallback behavior

### 2.7 Mission Completion Contracts

Define per-mission contract schema including:
- required artifacts/logs/command outputs
- mandatory verification step(s)
- explicit fail reasons when proof missing

Required outcomes:
- models cannot finish by assertion only
- post-run audits are machine-verifiable

## 3. Implementation Sequence (Phased)

### Phase A: Control Plane Foundations

1. add scheduler state model + timeline mapping
2. centralize tool-call canonical model
3. introduce adapter test fixtures for each provider

Acceptance gate:
- all providers pass tool-call translation/stream assembly fixture suite

### Phase B: Policy + Modes

1. introduce policy engine core + rule schema
2. wire `plan` vs `execute` mission modes
3. move approval decisions to policy engine

Acceptance gate:
- same mission in plan mode never executes mutating tool
- execution mode applies policy decisions deterministically

### Phase C: Hooks + Recovery

1. standardize pre/post hook result schema
2. implement typed failure classifier
3. implement fallback policy chain and availability TTL

Acceptance gate:
- injected failures route to expected recovery action in tests

### Phase D: Completion Hardening + Learning

1. mission-type proof contracts
2. completion validator rejects unsupported done claims
3. feed hook/failure/outcome features into behavior learning

Acceptance gate:
- regression suite demonstrates reduced timeout/halt rate vs baseline

## 4. Test Matrix (Must Run Per Release)

1. Providers:
- Ollama
- NVIDIA
- OpenRouter
- OpenAI

2. Models per provider:
- at least one "strong" and one "small/cheap" model

3. Mission scenarios:
- local runtime setup (e.g., choose/launch local GGUF runtime)
- multi-step code edit + test + verify
- failure injection (auth/model-not-found/timeout)

4. Success criteria:
- completion rate
- median turns to proof
- timeout rate
- false-complete rate
- fallback correctness

## 5. Immediate Next Engineering Tasks

1. Implement canonical tool-call DTO + provider translators.
2. Add scheduler state transitions into mission timeline API.
3. Add failure classifier and map existing error paths.
4. Add policy engine skeleton and migrate one mutating tool path.
5. Add one end-to-end "plan -> execute" mission flow test.

## 6. Notes On "Small Guardrail Agent" Idea

A lightweight local helper model can assist classification/summarization, but it should not be a primary reliability dependency. Core reliability must come from deterministic controller contracts (state machine, policy engine, fallback taxonomy, proof validator), so cloud and local models both benefit.
