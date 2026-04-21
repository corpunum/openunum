# Provider-Agnostic Prefix Cache Intent Implementation Plan

Status: handoff plan only. Do not implement from this document without a separate execution task.

## Purpose

Add prefix-cache readiness to OpenUnum without making the core runtime cloud-specific or OpenAI-specific.

The goal is not "OpenAI prompt caching" as a product feature. The goal is a model-agnostic prompt assembly contract that:

- keeps stable prompt content at the beginning of provider requests
- separates stable, semi-stable, and dynamic prompt sections
- exposes cache intent metadata to provider adapters
- lets each provider map that intent to native caching only when supported
- degrades to a no-op for providers and local runtimes without explicit cache controls
- preserves current fast-router, working-memory anchor, context-compaction, and tool-loop behavior

This fits the current operating reality:

- current runtime is cloud-primary while validation continues
- long-term OpenUnum direction remains local-first
- OpenUnum is a model-agnostic OS/framework, so provider-specific cache knobs must not leak into core agent logic

## Current Findings

Relevant current implementation points:

- `src/core/working-memory.mjs` already returns `staticPrefix`, `dynamicState`, `fullInjection`, and `cacheHints`.
- `src/core/agent.mjs` currently collapses working-memory injection back to `fullInjection`.
- `src/core/context-compiler.mjs` has an in-process static instruction cache, but it is not currently wired into the active `agent.mjs` chat path.
- `src/core/context-pack-builder.mjs` puts volatile runtime datetime near the top of the controller system message.
- Provider adapters currently send full payloads each call:
  - `src/providers/ollama.mjs`
  - `src/providers/openai-compatible.mjs`
  - `src/providers/openai-codex-oauth.mjs`
- Existing caches are useful but not provider prefix caching:
  - chat pending/completion handoff cache
  - fast-awareness classification cache
  - embedding cache
  - UI asset cache
  - runtime git overview cache
  - context compaction artifacts

## Design Principles

1. Core owns prompt determinism, not provider-specific cache mechanics.
2. Provider adapters own translation to native transport options.
3. Unsupported providers must preserve existing behavior exactly.
4. Prompt cache intent must be observable through trace/telemetry.
5. Cache optimization must never reduce safety, tool availability, or completion honesty.
6. Prefix stability must not bypass working-memory anchors, context pressure checks, compaction, role-model routing, ODD enforcement, or fast-awareness routing.
7. Local-first future support should be planned from day one, even if initial local providers no-op.

## Proposed Architecture

### 1. Prompt Packet Shape

Introduce a provider-agnostic prompt packet shape. This can be a new module or an extension around existing prompt assembly.

Candidate module:

- `src/core/prompt-cache-intent.mjs`

Suggested output shape:

```js
{
  messages,
  cacheIntent: {
    enabled: true,
    mode: 'prefix',
    scope: 'session',
    stablePrefixHash,
    semiStablePrefixHash,
    dynamicSuffixHash,
    cacheKey,
    retention: 'in_memory',
    sections: [
      { id: 'policy', stability: 'stable', tokensEstimate },
      { id: 'controller_static', stability: 'stable', tokensEstimate },
      { id: 'tool_schema', stability: 'stable', tokensEstimate },
      { id: 'working_memory_anchor', stability: 'semi_stable', tokensEstimate },
      { id: 'runtime_datetime', stability: 'dynamic', tokensEstimate },
      { id: 'retrieved_memory', stability: 'dynamic', tokensEstimate },
      { id: 'recent_turns', stability: 'dynamic', tokensEstimate }
    ]
  }
}
```

The exact field names can change, but the separation must remain explicit.

### 2. Prompt Section Ordering

Reorder prompt inputs so repeated content appears first.

Stable first:

- global/project/session policy text when unchanged
- controller identity and invariant behavioral rules
- safety/completion honesty rules
- tool schema if provider API puts tools into the same cached prefix
- static OpenUnum overview when behavior class requires it

Semi-stable next:

- working-memory `staticPrefix`
- agreed plan
- success contract
- current subplan only when unchanged
- role mode directive if stable for the current task class

Dynamic last:

- current datetime
- selected provider/model if it can change per attempt
- route hints
- facts
- hybrid memory hits
- strategy hints
- loaded skill snippets if they can change
- recent turns
- tool results
- continuation/revision instructions

Important: the current datetime must move out of the first lines of the controller system prompt, otherwise exact-prefix caching is defeated every turn.

### 3. Provider Capability Layer

Add a small capability layer to avoid cloud/provider coupling.

Suggested shape:

```js
{
  promptCache: {
    supported: false,
    supportsCacheKey: false,
    supportsRetention: false,
    supportsUsageMetrics: false,
    localKvCache: false
  }
}
```

Initial mappings:

- `openai` via OpenAI-compatible API: support optional `prompt_cache_key`, optional `prompt_cache_retention`, usage metrics when returned.
- `openai-codex-oauth`: support only if the underlying transport accepts equivalent fields; otherwise expose no-op and telemetry.
- `ollama-cloud`: no-op initially unless verified against the active Ollama endpoint.
- `ollama-local`: no-op initially, but preserve `cacheIntent` for future local KV/session support.
- `openrouter`, `nvidia`, `xiaomimimo`: no-op initially unless their specific APIs document compatible parameters.

Provider adapters should receive `cacheIntent` but must ignore it unless capability support is explicit.

### 4. Config

Add runtime config defaults with safe behavior:

```js
runtime: {
  promptCacheIntentEnabled: true,
  promptCacheProviderHintsEnabled: false,
  promptCacheRetention: 'in_memory',
  promptCacheKeyScope: 'session',
  promptCacheTelemetryEnabled: true
}
```

Notes:

- `promptCacheIntentEnabled` controls prompt packet metadata and stable ordering.
- `promptCacheProviderHintsEnabled` controls transport-specific parameters.
- Default provider hinting should be false until tests prove provider compatibility.
- No provider should fail because cache metadata exists.

### 5. Agent Integration

Likely integration points:

- `src/core/agent.mjs` before `runtimeProvider.chat(...)`
- `src/core/context-pack-builder.mjs` to separate stable and dynamic controller text
- `src/core/working-memory.mjs` to preserve `staticPrefix` and dynamic state separately
- provider `chat(...)` signatures to accept optional `cacheIntent`

Do not rewrite the full agent loop first. Start with a wrapper that returns existing `messages` unchanged plus metadata. Then migrate section ordering behind tests.

### 6. Telemetry

Add trace fields:

```js
trace.promptCache = {
  intentEnabled: true,
  providerHintSent: false,
  providerSupported: false,
  cacheKey,
  stablePrefixHash,
  dynamicSuffixHash,
  stablePrefixTokensEstimate,
  cachedTokens: null,
  cacheHitRatio: null
}
```

For OpenAI-compatible responses, parse usage fields when present:

- Chat Completions: `usage.prompt_tokens_details.cached_tokens`
- Responses-style transports: `usage.input_tokens_details.cached_tokens`

Do not assume usage exists.

## Implementation Phases

### Phase 0: Baseline Tests Before Behavior Changes

Add tests that capture current routing, anchor, and provider request behavior. These should fail only when behavior actually regresses.

No provider cache parameters yet.

### Phase 1: Cache Intent Metadata Only

Implement `cacheIntent` creation without changing message order or provider request bodies.

Expected outcome:

- all current tests pass
- trace includes prompt cache intent metadata
- provider adapters ignore cache intent

### Phase 2: Stable Prompt Ordering

Move volatile prompt parts later while preserving semantics.

Required checks:

- datetime still reaches the model
- current provider/model remains available
- facts, strategy hints, knowledge hits, and skill snippets still appear
- working-memory anchor still appears exactly once per provider call
- tool schemas still pass unchanged

### Phase 3: Provider Adapter No-Op Safety

Extend provider `chat(...)` signatures to accept optional `cacheIntent`.

No-op providers must produce byte-equivalent request bodies, except for harmless omitted undefined fields.

### Phase 4: Optional OpenAI-Compatible Mapping

Only after no-op safety is proven:

- map `cacheIntent.cacheKey` to `prompt_cache_key`
- map configured retention to `prompt_cache_retention` when enabled
- record cached-token metrics when returned

Keep this behind `runtime.promptCacheProviderHintsEnabled`.

### Phase 5: Local-First Follow-Up

Do not guess local cache mechanics. Add a future provider capability for local KV/session cache once the selected local backend is explicit.

Possible future targets:

- llama.cpp server prompt cache/session flags
- Ollama session behavior if exposed and documented
- custom local runtime with reusable KV cache handles

The prompt packet design should already support this without core rewrites.

## Required Tests

### Test 1: Back-To-Back Fast-Router Task-Meta Prompt Preserves Anchor

Purpose:

Verify that two consecutive OpenUnum agent prompts in the same session still exercise fast-awareness routing and working-memory context correctly after prefix-cache intent is introduced.

Suggested file:

- `tests/phase57.prompt-cache-intent-fast-router-anchor.e2e.mjs`

Flow:

1. Start isolated OpenUnum server with a controlled fake provider or existing isolated test harness.
2. Create a fresh session id.
3. POST `/api/chat`:

```text
For this prefix-cache-intent test, do not edit files. The task is to verify that OpenUnum remembers the active task, the success criteria, and the current step across back-to-back prompts.
```

4. POST `/api/chat` immediately again in the same session:

```text
What is my current task, what are the success criteria, and what step are we on?
```

Assertions:

- second response is non-empty
- second response references the first prompt's task, not a generic status answer
- trace indicates fast-awareness classification is task-meta or fast-path/router-fast where available
- second turn executes zero mutating tools
- no file changes are made
- if provider request capture is available, exactly one `WORKING MEMORY ANCHOR` system injection appears in the second provider call
- `trace.promptCache.intentEnabled === true`
- `trace.promptCache.stablePrefixHash` exists
- dynamic suffix hash may differ between turns, but stable prefix hash should remain stable unless policy/tool schema/session anchor changed

Regression risk covered:

- fast-router bypassed by cache wrapper
- anchor dropped or duplicated
- cache metadata changes model-visible semantics
- task-meta follow-up gets stale or generic answer

### Test 2: Back-To-Back Continuation Prompt Keeps Anchor And Dynamic State Separate

Purpose:

Verify that normal continuation behavior still works when the prompt is split into stable and dynamic sections.

Suggested file:

- `tests/phase58.prompt-cache-intent-continuation-anchor.e2e.mjs`

Flow:

1. Start isolated OpenUnum server with fake provider that captures request messages and returns deterministic assistant text.
2. Create a fresh session id.
3. POST `/api/chat`:

```text
Prefix cache continuation test. Do not change files. Plan two conceptual steps: first identify the current task, then report whether the anchor survived. Answer briefly.
```

4. POST `/api/chat` immediately again:

```text
Continue with the next step. Before answering, use the original task and say whether the anchor survived.
```

Assertions:

- second response references the original task from prompt 1
- second response does not restart from scratch or ask the user to restate the goal
- provider-captured second request contains one anchor section, not zero and not duplicates
- anchor/static section appears before recent turns
- dynamic recent-turn content appears after stable/semi-stable sections
- current datetime appears in a dynamic section, not before stable controller identity/policy
- `trace.promptCache.stablePrefixHash` remains equal across the two calls when policy/tool schema/session static anchor did not change
- `trace.promptCache.dynamicSuffixHash` changes or is allowed to change
- tool allowlist and ODD envelope still appear in trace

Regression risk covered:

- continuation prompt loses the working-memory anchor
- dynamic state accidentally moves ahead of stable prefix
- repeated anchor injection bloats context
- prompt-cache wrapper changes tool routing or execution envelope

### Test 3: Provider No-Op Compatibility For Local/Ollama

Purpose:

Ensure local-first paths are not broken by cloud cache work.

Suggested file:

- `tests/unit/prompt-cache-intent-provider-noop.test.mjs`

Flow:

1. Build an Ollama provider request with `cacheIntent`.
2. Build the same request without `cacheIntent`.
3. Compare generated request bodies.

Assertions:

- Ollama body remains unchanged unless explicit local capability is implemented later
- no OpenAI-specific fields are sent to Ollama
- tools and messages are unchanged

Regression risk covered:

- OpenAI cache parameters leak into local providers
- provider-agnostic contract becomes cloud-specific

### Test 4: OpenAI-Compatible Cache Hint Is Gated

Purpose:

Ensure OpenAI cache fields are optional and config-gated.

Suggested file:

- `tests/unit/prompt-cache-intent-openai-compatible.test.mjs`

Flow:

1. Create OpenAI-compatible provider request with cache intent and `promptCacheProviderHintsEnabled: false`.
2. Verify no cache fields are sent.
3. Enable `promptCacheProviderHintsEnabled: true`.
4. Verify request includes supported cache fields.
5. Simulate response usage with cached-token details.

Assertions:

- `prompt_cache_key` appears only when enabled
- `prompt_cache_retention` appears only when enabled and configured
- cached-token metrics are parsed when present
- absence of usage metrics does not throw

Regression risk covered:

- unexpected provider API breakage
- telemetry assumes usage fields exist
- config gating ineffective

## Acceptance Criteria

Implementation is acceptable only when:

- existing `pnpm verify` passes or failures are unrelated and documented
- back-to-back prompt tests pass
- local/Ollama no-op provider test passes
- OpenAI-compatible cache hinting is disabled by default
- trace includes prompt cache intent metadata
- no provider-specific cache terminology leaks into core agent decisions
- docs mention this as "prompt cache intent / stable prefix layout", not "OpenAI cache"

## Suggested Execution Order For The Implementing Agent

1. Add tests for current behavior and provider no-op safety.
2. Add `prompt-cache-intent` metadata builder with no behavior change.
3. Wire trace metadata.
4. Split controller prompt into stable and dynamic sections.
5. Preserve working-memory `staticPrefix` as a first-class section.
6. Reorder dynamic fields after stable fields.
7. Add provider signature compatibility with no-op defaults.
8. Add OpenAI-compatible gated transport mapping.
9. Add usage telemetry parsing.
10. Update docs and route/runtime telemetry references.

## Non-Goals

- Do not cache model responses.
- Do not skip model calls because a prefix matched.
- Do not make OpenAI the architectural baseline.
- Do not assume Ollama or local backends support KV cache controls without verification.
- Do not remove context compaction or hybrid retrieval.
- Do not reduce safety prompts to improve cache hit rate.
- Do not move tool schemas after dynamic user content if doing so breaks provider tool semantics.

## Open Questions

- Should `cacheKey` scope default to `session`, `workspace`, or `provider-model`?
- Should stable prefix hashes include tool schemas, given tool availability can vary by execution envelope?
- Should role-mode directives be stable enough to include in prefix, or dynamic because they vary per turn?
- Should `ollama-cloud` be treated as local-compatible no-op or cloud-compatible no-op until its API behavior is verified?
- Where should prompt cache telemetry surface in the WebUI: trace panel only, runtime dashboard, or both?
