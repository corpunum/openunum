# Local Runtime Validation

Date: 2026-04-01

## Scope

This pass focused on three problems:

1. Stop turn-budget loss inside tool retries and interactive local-runtime probes.
2. Make cloud controllers recover cleanly when local Ollama verification is slow or mis-invoked.
3. Determine the minimum viable controller requirements for OpenUnum, with special attention to the local aggressive Qwen model.

## Code Changes

- [src/core/missions.mjs](/home/corp-unum/openunum/src/core/missions.mjs)
  - proof-aware mission completion for local-runtime goals
  - stronger recovery hints for:
    - bad `ollama` CLI forms
    - timed-out local generation
    - fake `systemctl` Ollama service probing
    - metadata inspection loops
- [src/core/agent.mjs](/home/corp-unum/openunum/src/core/agent.mjs)
  - cloud controllers keep bounded turn budgets even on local-runtime tasks
  - provider failure traces remain visible
- [src/tools/runtime.mjs](/home/corp-unum/openunum/src/tools/runtime.mjs)
  - `http_request` path for bounded API verification
  - shell-to-API rewrite for simple `curl`
  - fast-fail clamp for interactive shell probes
  - Ollama compatibility handling for bad `ollama run` forms
  - exact context hint for local aggressive Qwen:
    - `ollama/qwen3.5-9b-uncensored-aggressive:latest` => `16384`
- [src/tools/executor-daemon.mjs](/home/corp-unum/openunum/src/tools/executor-daemon.mjs)
  - deterministic shell syntax/usage failures are no longer retried
- [src/providers/openai-compatible.mjs](/home/corp-unum/openunum/src/providers/openai-compatible.mjs)
  - fetch failures now expose useful transport error details
- [src/providers/index.mjs](/home/corp-unum/openunum/src/providers/index.mjs)
  - NVIDIA model id normalization fixed for full ids like `nvidia/llama-3.3-nemotron-super-49b-v1`
- [src/config.mjs](/home/corp-unum/openunum/src/config.mjs)
  - added explicit local Qwen context hints

## Validation Results

### 1. `ollama/kimi-k2.5:cloud`

Result: success

- Mission completed end-to-end on a fresh copied-home instance.
- The controller selected `llama_cpp_python` on its own after local verification pressure.
- It loaded the target GGUF and produced proof-backed output.
- This is the current best verified cloud-controller path for the target mission.

Observed behavior:

- bounded tools
- correct pivot away from slow Ollama API path
- proper `MISSION_STATUS: DONE` completion

### 2. `ollama/minimax-m2.7:cloud`

Result: partial success, acceptable behavior

- It correctly inspected state.
- It attempted Ollama HTTP verification.
- After timeout, it accepted the mission recovery hint and pivoted to a different runtime path instead of repeating the same slow request.

Observed behavior:

- no infinite retry loop
- no repeat of timed-out local generation unchanged
- valid pivot behavior

This is materially better than the original halt pattern even when the run is not yet fully closed inside the observation window.

### 3. `nvidia/llama-3.3-nemotron-super-49b-v1`

Result: provider fixed, mission behavior improved, still less reliable than Kimi/Minimax

- Plain `/api/chat` works.
- Tool-using `/api/chat` works.
- Full mission no longer fails from provider misconfiguration or silent fallback.
- The remaining weakness is controller quality on local-runtime tasks:
  - bad assumptions about local Ollama surfaces
  - slower first-turn synthesis
  - weaker direct pivot discipline than the best Ollama cloud controllers

Net: transport is fixed; mission quality is controller-limited.

### 4. `nvidia/qwen/qwen3.5-397b-a17b`

Result: not recommended as primary controller for this mission

- The controller timed out at first-turn synthesis under the tested local-runtime mission.
- The mission then fell through to fallback behavior.

Net: not stable enough for this OpenUnum controller path as currently wired.

### 5. `ollama/qwen3.5-9b-uncensored-aggressive:latest`

Result: cannot act as an OpenUnum controller through current Ollama tool-calling path

Plain chat test returned:

- `Ollama provider failed: 400 {"error":"registry.ollama.ai/library/qwen3.5-9b-uncensored-aggressive:latest does not support tools"}`

Implication:

- This is not a context-window problem.
- This is not a timeout problem.
- This is a hard controller capability gap: OpenUnum currently expects provider-side tool calling, and this model does not expose it through the Ollama chat/tool interface.

The model may still be usable as:

- a local inference target launched by the agent
- a summarizer/verifier if a non-tool text-only lane is added later

But it is not a viable drop-in controller in the current architecture.

## Minimum Requirements For A Viable OpenUnum Controller

A model/provider path needs all of the following:

1. Tool calling support through the provider transport
2. Reliable short-turn synthesis under bounded budgets
3. Ability to recover from local-runtime verification failures without repeating the same tool path
4. Tolerance for compact but tool-heavy prompts

For local-runtime missions specifically, the controller also needs:

1. API-first bias for local services
2. willingness to pivot from slow Ollama API to `llama_cpp_python` or another local runtime
3. avoidance of REPL-like CLI verification

## Recommended Setup

Best current primary controller:

- `ollama/kimi-k2.5:cloud`

Acceptable fallback controller:

- `ollama/minimax-m2.7:cloud`

Conditional cloud alternative:

- `nvidia/llama-3.3-nemotron-super-49b-v1`
  - provider transport is now fixed
  - still weaker on mission execution quality than the two Ollama cloud controllers above

Not recommended as controller:

- `nvidia/qwen/qwen3.5-397b-a17b`
- `ollama/qwen3.5-9b-uncensored-aggressive:latest`

## Local Model Conclusion

If the goal is "OpenUnum should run on the minimum local model alone", the current blocker is not raw model size first. The blocker is controller capability:

- native/provider-exposed tool calling
- stable structured execution under tool loops

The aggressive local Qwen can be launched and used as a target model, but not yet as a controller through the current Ollama provider contract.

To make such local models viable as controllers, OpenUnum would need a new fallback lane such as:

1. prompt-based tool-call emulation for non-native-tool models
2. a deterministic router/verifier layer that reduces reliance on model-native tool calls

Without that extra layer, the minimum practical setup remains a cloud controller plus local runtime execution.
