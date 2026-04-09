# OpenUnum Model-Backed Tools Strict Handoff (2026-04-09)

This document is the canonical implementation handoff for adding model-backed tools to OpenUnum without changing the current tool-calling logic.

## Verdict

Yes, this is a good idea for OpenUnum if it is implemented narrowly and honestly:

- keep tools as the stable outer contract
- keep the current controller -> tool-call -> runtime flow intact
- treat small local models as one possible backend behind a logical tool
- start with read-only, schema-bounded capabilities
- do not let model-backed tools become silent authority paths

This can increase value, efficiency, and performance in OpenUnum because it gives the framework cheap local micro-capabilities for narrow jobs such as summarization and classification, while preserving the current general controller behavior for broader reasoning and orchestration.

It is not a good idea if implemented as:

- a second orchestration framework
- a hidden model router stuffed into `src/providers/index.mjs`
- a broad replacement for existing deterministic tools
- a mutation-capable path before validation contracts are unified

## Repo-Grounded Assessment

The current codebase already has most of the primitives needed:

- stable tool execution surface: `src/tools/runtime.mjs`
- stable outer chat/controller loop: `src/core/agent.mjs`
- provider construction: `src/providers/index.mjs`
- retry/backoff executor: `src/tools/executor-daemon.mjs`
- execution policy: `src/core/execution-policy-engine.mjs`
- model/tier tool gating: `src/core/model-execution-envelope.mjs`
- role-to-model hints: `src/core/role-model-registry.mjs`
- tool catalog surface: `GET /api/tools/catalog`
- one existing example of a model-backed capability pattern: `executeModelNativeSearch()` in `src/tools/runtime.mjs`

That means OpenUnum does not need a new philosophy or a new framework for this. It needs a backend layer under the current tool domain.

## Why This Is Worth Doing

### Value

- Adds reusable framework-native capabilities such as `summarize`, `classify`, and later `extract`.
- Makes these capabilities explicit and inspectable instead of burying them inside prompts or controller heuristics.
- Gives the framework a cleaner place for narrow cognition jobs that do not need the full controller loop.

### Efficiency

- Offloads narrow formatting/classification work from stronger cloud controllers.
- Reduces pressure on the main controller prompt by moving bounded micro-tasks into strict tool calls.
- Makes backend choice swappable per logical tool instead of per whole chat turn.

### Performance

- Local compact models can answer narrow contracts faster than a broad controller turn in many cases.
- Deterministic output shapes reduce recovery loops and parsing noise.
- Read-only micro-tools can be serial and cheap on constrained hardware without destabilizing the main runtime.

## What Must Not Change

- Do not change the controller/tool-calling logic in `src/core/agent.mjs`.
- Do not introduce another orchestrator.
- Do not bypass `ToolRuntime` as the stable execution surface.
- Do not make `skills` the mandatory outer interface.
- Do not move backend strategy into `src/providers/index.mjs`.
- Do not grant direct filesystem, shell, browser, network, policy, or secret authority to model-backed tools.

## Main Disagreements With A Naive Version Of The Idea

I agree with the direction, but not with a loose interpretation of "camouflaged as tools."

The correct interpretation is:

- a logical tool remains a real OpenUnum tool
- its contract is explicit
- its backend may be deterministic code, skill, model, or composite
- the backend is visible in config, traces, tests, and docs

The wrong interpretation is:

- pretend arbitrary model prompts are tools
- hide backend behavior from the catalog and runtime contracts
- let model-backed tools mutate state because they look "internal"

## Current Blockers In The Repo

Before implementation, the next agent must acknowledge these realities:

### 1. Validation truth is split

There are currently two overlapping validation systems:

- `src/core/preflight-validator.mjs`
- `src/core/tool-validator.mjs`

They are not aligned. Example: `tool-validator.mjs` expects `shell_run.command`, while the active runtime path uses `shell_run.cmd`.

Model-backed tools should not be added on top of this split. The first implementation step must unify the contract source.

### 2. `ToolRuntime` is still a large inline dispatch surface

`src/tools/runtime.mjs` is the correct outer integration point, but backend logic should not be piled into its existing `if (name === ...)` chain forever.

### 3. Local-model reality is constrained

Current provider/model reality is:

- `ollama-local`: local CPU lane, `gemma4:cpu` plus embeddings
- `ollama-cloud`: cloud lane

That means the framework path should be built first, even if phase-one local backend choice remains limited or partly disabled until additional compact local models are introduced and validated.

## Architectural Decision

OpenUnum should adopt:

### Stable logical tools

Examples:

- `summarize`
- `classify`
- `extract`
- `extract`

These are OpenUnum capability names. They are not model names.

### Dedicated backend layer under the tool domain

Recommended new area:

- `src/tools/backends/registry.mjs`
- `src/tools/backends/contracts.mjs`
- `src/tools/backends/profiles.mjs`
- `src/tools/backends/governor.mjs`
- `src/tools/backends/adapters/*.mjs`

`src/tools/runtime.mjs` remains the stable surface.

`src/providers/index.mjs` remains a provider-construction layer, not a backend-strategy layer.

## Initial Scope

Start with the smallest safe vertical slice:

### Phase-one logical tools

- `summarize`
- `classify`
- `extract`

### Optional third tool only if the first two remain clean

- `extract`

### Explicitly postponed

- code patching
- reranking
- multi-document reasoning tools
- vision tools
- mutation-capable "suggest/apply" flows

## Required Contract Model

Each logical tool must define:

- name
- purpose
- input schema
- output schema
- confidence semantics
- validation rules
- allowed side effects
- fallback policy
- resource class
- backend eligibility rules

Required normalized output shape:

```json
{
  "ok": true,
  "tool": "summarize",
  "data": {},
  "confidence": 0.0,
  "backend": {
    "type": "model",
    "id": "gemma4-summary-v1",
    "provider": "ollama-local",
    "model": "ollama-local/gemma4:cpu"
  },
  "validation": {
    "schemaOk": true,
    "contractOk": true
  }
}
```

Failure shape must be equally explicit:

```json
{
  "ok": false,
  "tool": "classify",
  "error": "validation_failed",
  "backend": {
    "type": "model",
    "id": "gemma4-classify-v1"
  },
  "details": "Malformed output: missing label"
}
```

## Backend Types

Supported backend kinds should be:

- `deterministic`
- `skill`
- `model`
- `composite`

Phase one should implement `model` cleanly and allow the registry to describe the others, but it should not overbuild composite behavior yet.

## Model Selection Policy

Model choice must be registry-driven and config-driven, not hardcoded in tool implementations.

Phase-one selection rule:

1. current integrated local model if it satisfies the contract and resource limits
2. current integrated cloud fallback if local quality is insufficient
3. future compact model only after explicit onboarding and evaluation

This means:

- build the framework first
- do not hardcode specific models in `summarize`, `classify`, or `extract`
- tolerate "no suitable local backend currently configured" as a valid runtime state

## Hardware Governance

For current hardware assumptions, model-backed tools must be conservative:

- local model-backed inference serial-first by default
- max concurrent local model-backed jobs: `1`
- bounded queue depth
- strict timeout per backend profile
- CPU-only enforcement for `ollama-local`
- explicit fallback or graceful refusal when resources are tight

This should extend existing execution-envelope/runtime config patterns rather than creating a second resource-governor framework.

## Implementation Phases

### Phase 0: Unify contract truth

Goal:

- one shared contract source for tool schemas and validation semantics

Tasks:

- define a shared contract module consumed by:
  - `src/tools/runtime.mjs`
  - `src/core/preflight-validator.mjs`
  - `src/core/tool-validator.mjs`
  - `/api/tools/catalog`
- remove arg-name drift and duplicate schema truth
- ensure output-side contract semantics exist, not only input-side validation

Exit:

- no duplicated tool schema truth
- `shell_run` and other tool contracts are consistent everywhere

### Phase 1: Add backend substrate

Goal:

- introduce a tool-backend layer without changing controller behavior

Tasks:

- add `src/tools/backends/registry.mjs`
- add `src/tools/backends/contracts.mjs`
- add `src/tools/backends/profiles.mjs`
- add `src/tools/backends/governor.mjs`
- add at least one adapter module under `src/tools/backends/adapters/`

Exit:

- the runtime can resolve backend metadata for a logical tool

### Phase 2: Runtime integration

Goal:

- let `ToolRuntime` dispatch to backends while preserving the existing outer flow

Tasks:

- extend `toolSchemas()` and `toolCatalog()` to expose logical tools from the backend registry
- extend `run()` so logical tools can delegate to the backend layer
- keep existing deterministic tools working unchanged
- keep trace/result logging unchanged at the outer level

Exit:

- controller still calls tools normally
- runtime chooses backend internally

### Phase 3: First vertical slice

Goal:

- ship one real end-to-end model-backed path

Tasks:

- implement `summarize`
- implement `classify`
- implement `extract`
- optionally implement `extract` only if first two stay simple
- keep them read-only and non-authoritative

Exit:

- controller can call these tools through the existing runtime path
- outputs are normalized and schema-validated

### Phase 4: Config and swap path

Goal:

- make backend choice inspectable and swappable

Tasks:

- add runtime config area for model-backed tool profiles and routing
- add rollback-safe feature flags
- add CLI and API visibility before WebUI editing

Recommended config direction:

- `runtime.modelBackedTools.enabled`
- `runtime.modelBackedTools.exposeToController`
- `runtime.modelBackedTools.localMaxConcurrency`
- `runtime.modelBackedTools.queueDepth`
- `runtime.modelBackedTools.tools.<toolName>.backendProfiles`

Exit:

- backend swaps do not require code edits

### Phase 5: Tests and evaluation

Goal:

- prove the feature is safe and worth keeping

Tasks:

- contract tests
- backend-compatibility tests
- malformed-output tests
- timeout/fallback tests
- local resource tests
- regression tests for existing tools and catalog truth
- lightweight quality eval sets for `summarize`, `classify`, and `extract`

Exit:

- no silent policy bypass
- no broken existing tool surface
- evidence that the new tools are useful

### Phase 6: Docs and onboarding

Goal:

- make the feature a documented OpenUnum framework capability

Tasks:

- update `BRAIN.MD`
- update `docs/ARCHITECTURE.md`
- update `docs/CODEBASE_MAP.md`
- update `docs/AGENT_ONBOARDING.md`
- update `docs/API_REFERENCE.md`
- update `docs/CONFIG_SCHEMA.md`
- update `README.md`
- update `OPENUNUM_EXPLAINED.md`
- update `CHANGELOG.md`
- add `docs/MODEL_BACKED_TOOLS.md` after the code exists

Exit:

- onboarding and docs describe the real implementation, not the aspiration

## Files Most Likely To Change

Core implementation:

- `src/tools/runtime.mjs`
- `src/core/preflight-validator.mjs`
- `src/core/tool-validator.mjs`
- `src/core/model-execution-envelope.mjs`
- `src/providers/index.mjs` only if a narrow helper is required for explicit provider/model construction

New modules:

- `src/tools/backends/registry.mjs`
- `src/tools/backends/contracts.mjs`
- `src/tools/backends/profiles.mjs`
- `src/tools/backends/governor.mjs`
- `src/tools/backends/adapters/model-json-tool.mjs`
- `src/tools/backends/adapters/deterministic-wrapper.mjs`

Tests:

- `tests/unit/*model-backed*.test.mjs`
- `tests/unit/*tool-contract*.test.mjs`
- targeted e2e around `/api/tools/catalog` and `/api/chat`

Docs:

- `BRAIN.MD`
- `docs/ARCHITECTURE.md`
- `docs/CODEBASE_MAP.md`
- `docs/AGENT_ONBOARDING.md`
- `docs/API_REFERENCE.md`
- `docs/CONFIG_SCHEMA.md`
- `README.md`
- `OPENUNUM_EXPLAINED.md`
- `CHANGELOG.md`

## Testing Matrix

### Contract tests

- valid input accepted
- invalid input rejected
- schema-valid output accepted
- malformed model output rejected
- empty output rejected
- confidence thresholds enforced

### Backend-compat tests

- same logical tool works with deterministic backend and model backend
- same caller sees same normalized shape
- backend swap does not break catalog or caller assumptions

### Runtime/resource tests

- serial local inference enforcement
- bounded queue depth
- timeout handling
- fallback/refusal handling

### Regression tests

- existing tool catalog remains truthful
- existing deterministic tools still run
- no policy bypass
- no mutation authority leaks into model-backed tools

### Quality evaluation

- `summarize`: preserves required facts, not just shorter text
- `classify`: label accuracy and calibration
- `extract`: field extraction accuracy and schema success rate
- `extract`: schema success rate and field accuracy

## Acceptance Criteria

The feature is acceptable only if all of the following are true:

- tool-calling logic in `src/core/agent.mjs` is unchanged in principle
- `ToolRuntime` remains the stable execution surface
- logical tools have one canonical contract source
- model-backed tools are visible in catalog/config/docs/tests
- model-backed tools are read-only in phase one
- local resource usage is bounded and serial-first
- existing deterministic tools still work
- docs and onboarding are updated

## Rollback Plan

Rollback must be simple:

- feature flag disables model-backed tools globally
- logical tools can be hidden from the catalog without removing the backend layer
- per-tool backend profile can be disabled independently
- runtime falls back to deterministic/no-op refusal, not undefined behavior

## Final Recommendation To The Next Agent

Implement this.

But implement it as a framework extension under the current tool runtime, not as a hidden model-routing trick.

The correct first milestone is:

- unify contracts
- add backend registry
- expose `summarize`
- expose `classify`
- expose `extract`
- keep everything read-only
- prove it with tests

Do not broaden scope until that slice is clean.
