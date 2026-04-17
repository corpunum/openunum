# Model-Aware Controller

Date: 2026-04-02

## Why this exists

Different provider/model paths behave differently under the same mission:

- some are strict with tool payload shape
- some over-plan before acting
- some time out while reasoning
- some are fragile on local runtime execution

OpenUnum now uses a behavior-class controller layer so guardrails are adaptive without becoming per-model hardcoded logic.

## Behavior classes

Current behavior classes in `src/core/model-behavior-registry.mjs`:

1. `tool_native_strict`
2. `tool_native_loose`
3. `planner_heavy_no_exec`
4. `local_runtime_fragile`
5. `timeout_prone_deep_thinker`

Each class includes:

- execution tuning (`turnBudgetMs`, `maxIters`, proof requirement)
- context-pack needs
- class description for runtime trace/debug

## Runtime pipeline

For each provider attempt in `src/core/agent.mjs`:

1. classify behavior for provider/model
2. merge class tuning with base execution profile
3. build class-aware context pack (system/repo/openunum guidance)
4. enforce execution contract during iteration:
   - continue if model is planning without execution
   - reject unproven completion claims
5. learn from trace and update behavior registry heuristics

## Context packs

`src/core/context-pack-builder.mjs` builds the first-class model context with:

- execution profile guidance/guardrails
- behavior class metadata
- OpenUnum feature overview
- repo orientation
- memory/strategy/skills snippets

This replaces fragile one-size-fits-all prompts with controlled reusable packs.

## Execution contract

`src/core/execution-contract.mjs` provides deterministic checks:

- planner-without-execution continuation forcing
- proof-backed DONE gate for mission claims
- bounded recovery directive for summarization turns

This keeps model style differences from breaking mission correctness.

## Operator controls

Optional per-provider or per-model behavior overrides are supported via config:

```json
{
  "model": {
    "behaviorOverrides": {
      "ollama": { "classId": "local_runtime_fragile" },
      "ollama::ollama/qwen3.5-9b-uncensored-aggressive:latest": {
        "classId": "planner_heavy_no_exec",
        "tuning": { "maxIters": 4, "turnBudgetMs": 60000 }
      }
    }
  }
}
```

Key format:

- provider key: `<provider>`
- exact key: `<provider>::<model>`

## Bug Fixes (2026-04-17)

Six bugs fixed that caused `ollama-cloud/qwen3.5:397b-cloud` to return "No response generated." on every non-trivial query:

1. **Behavior description leak in system prompt**: `context-pack-builder.mjs` included `Behavior description: ${behavior.description}` in the controller system message. Qwen 3.5 interpreted class descriptions like "Produces plans without acting" literally, returning empty `content` with all reasoning in the `thinking` field. Fix: removed description line from prompt; only expose `classId`, `confidence`, `source`, and `needs`.

2. **`ollama-cloud` falls through `defaultBehaviorFor`**: `model-behavior-registry.mjs` only checked `p === 'ollama'`, so `ollama-cloud` fell through to the `planner_heavy_no_exec` default instead of `timeout_prone_deep_thinker`. Fix: both `ollama` and `ollama-cloud` now share the same conditional branches.

3. **Council revision overwrites good replies**: The council proof-scorer triggered revision turns whose recursive `runOneProviderTurn` returned "No response generated." (from empty Qwen thinking-only content), overwriting the good first-response `finalText`. Fix: only accept revision `finalText` if it is not the "No response generated." fallback.

4. **Turn budget too tight for cloud models**: `strict-shell-cloud` profile had `turnBudgetMs: 60000`, `maxIters: 3`. A 397B model needs ~6s per inference call; 60s was insufficient for multi-iteration turns with tool execution. Fix: `turnBudgetMs: 180000`, `maxIters: 4`.

5. **Planner misclassification on tool-free responses**: `learnControllerBehavior` classified any turn with `toolRuns === 0 && iterations > 1` as `planner_heavy_no_exec`, even when the model returned substantive assistant content. Knowledge/creative queries legitimately don't need tools. Fix: only classify as planner if no iteration has assistant content >20 chars.

6. **Hard timeout killing agent turns**: `chatHardTimeoutMs` defaulted to 90s in `chat_runtime.mjs`, killing cloud-model agent loops mid-processing. Fix: set to 300s in runtime config.

## Next hardening pass

1. Persist behavior registry snapshots to SQLite for cross-restart learning.
2. Add telemetry endpoint for class assignment and per-class success rates.
3. Add class-aware fallback graph policy (not only ordered provider list).
4. Add benchmark harness to elicit/score top models per provider before enabling as default controller routes.
