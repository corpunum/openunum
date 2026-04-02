# Competitive Analysis: Claw Code (Model/Tool Reliability)

Date: 2026-04-02

Scope:
- Analyze why Claw Code-style harnesses often look more stable across many models (including OpenAI-compatible/Ollama paths) and extract practical upgrades for OpenUnum.
- Primary source used in this pass: local archive `/home/corp-unum/Downloads/claw-code-main.zip` unpacked under `/tmp/claw-code-main/claw-code-main`.

Note:
- `https://github.com/ultraworkers/claw-code` was disabled at analysis time.
- Findings below are from the provided ZIP source tree.

## 1. What Claw Code Is Doing Better (From Source)

### 1.1 Prompt/context packing is deterministic and layered

Claw runtime builds a structured system prompt with stable sections and a dynamic boundary marker:
- `rust/crates/runtime/src/prompt.rs`
  - `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`
  - fixed sections: intro, system, doing-tasks, action-care
  - environment + project context + config append

It also auto-discovers instruction files through ancestor chain:
- `CLAW.md`
- `CLAW.local.md`
- `.claw/CLAW.md`
- `.claw/instructions.md`

This improves model consistency because task rules are always injected via a predictable layout.

### 1.2 Tool-call translation for OpenAI-compatible APIs is explicit and robust

OpenAI-compatible adapter (`rust/crates/api/src/providers/openai_compat.rs`) does careful conversion:
- Anthropic-like structured messages -> OpenAI chat payload
- tool defs as function tools
- tool choice translation (`auto`, `required`, named tool)
- streaming delta accumulation for partial tool call arguments
- finish-reason normalization (including `tool_calls` -> `tool_use`)

This adapter quality is a major reason heterogeneous models "work" in one harness despite differing provider quirks.

### 1.3 Retry/backoff is explicit at provider transport layer

`OpenAiCompatClient` includes retry policy with bounded exponential backoff:
- defaults:
  - initial backoff: 200ms
  - max backoff: 2s
  - max retries: 2
- retries only retryable failures
- returns typed retry exhaustion errors

This creates predictable behavior under transient API errors.

### 1.4 Permission + hook guardrails are first-class runtime primitives

Conversation runtime does:
- tool permission authorization before execution
- pre-tool hook execution
- tool execution
- post-tool hook execution
- deny/allow propagation into tool results

Files:
- `rust/crates/runtime/src/permissions.rs`
- `rust/crates/runtime/src/hooks.rs`
- `rust/crates/runtime/src/conversation.rs`

This makes policy enforcement and interception composable and traceable.

### 1.5 Sub-agent execution uses bounded iterations and constrained tool sets

Sub-agent runtime path:
- per-agent allowed tool list by sub-agent type
- explicit max iterations (`DEFAULT_AGENT_MAX_ITERATIONS`)
- dedicated agent system prompt appendix

File:
- `rust/crates/tools/src/lib.rs`

This reduces runaway behavior and improves completion discipline.

## 2. Where OpenUnum Is Already Strong

OpenUnum already has:
- proof-aware mission completion and rejection of unsupported "DONE" claims
- mission watchdog and recovery hints
- model behavior classes + learned tuning (`/api/controller/behaviors`)
- provider routing + fallback controls
- mission timeline/operator telemetry surfaces

So the gap is not "no guardrails"; the main gap is transport normalization depth and stricter per-provider execution contracts for tool-calling edge cases.

## 3. Concrete Deltas To Close

1. Harden provider adapters with Claw-style explicit message/tool normalization:
- maintain one canonical internal message/tool shape
- convert to provider-specific payloads with strict, tested translators
- normalize streaming tool-call assembly and finish reasons centrally

2. Move retries to typed transport layer policy per provider:
- classify retryable vs non-retryable by status/error class
- provider-specific retry budgets
- include jitter/backoff caps

3. Expand hook pipeline to operator-defined interception:
- explicit pre/post tool hooks with deny semantics
- hook outcome surface in execution trace and mission timeline

4. Increase deterministic context packing:
- stable section ordering
- explicit dynamic boundary
- stronger instruction-file cascade and dedupe strategy

5. Tighten sub-agent defaults:
- tool allowlists by role
- default max iteration caps
- mandatory concise terminal report schema

## 4. Why This Matters For Ollama + Qwen

When local models fail in harnessed execution, causes are usually:
- weak tool-call argument streaming/parsing normalization
- inconsistent prompt contract and missing local instruction loading
- no strict retry classification and fallback discipline
- route loops (interactive shell retries) without narrow terminal criteria

Claw-style handling mitigates these by being explicit at each layer: prompt, payload, stream parser, permission/hook loop, retry policy, and bounded completion.

## 5. Action Plan For OpenUnum (Recommended Implementation Sequence)

1. Provider translation hardening pass:
- define canonical tool-call state machine and provider translators
- add e2e fixtures for streaming partial tool-call arguments

2. Retry-policy framework:
- move retry rules into per-provider policy objects
- include non-retryable auth/model-not-found fast-fail path

3. Hook framework:
- implement pre/post tool hook execution with deny/warn/allow outcomes
- emit hook metadata in trace and mission timeline

4. Sub-agent discipline:
- role-based tool allowlists + max iteration defaults
- final report contract for spawned workers

5. Regression matrix:
- run same mission across representative Ollama/NVIDIA/OpenRouter/OpenAI models
- compare success/failure signatures and tune behavior profiles.

## 6. Source References Used

- `/tmp/claw-code-main/claw-code-main/rust/crates/runtime/src/prompt.rs`
- `/tmp/claw-code-main/claw-code-main/rust/crates/runtime/src/conversation.rs`
- `/tmp/claw-code-main/claw-code-main/rust/crates/runtime/src/permissions.rs`
- `/tmp/claw-code-main/claw-code-main/rust/crates/runtime/src/hooks.rs`
- `/tmp/claw-code-main/claw-code-main/rust/crates/api/src/providers/openai_compat.rs`
- `/tmp/claw-code-main/claw-code-main/rust/crates/api/src/providers/mod.rs`
- `/tmp/claw-code-main/claw-code-main/rust/crates/tools/src/lib.rs`
