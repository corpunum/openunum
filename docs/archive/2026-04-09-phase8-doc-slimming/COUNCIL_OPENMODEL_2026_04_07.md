## Open-Model Pragmatism Evaluation

**Date:** 2026-04-07  
**Evaluator:** Council Member 5 (Subagent)  
**Inspiration:** Maziyar Panahi's OpenMed Approach  
**Scope:** `/home/corp-unum/openunum/`

---

### Provider/Model Support

**Current Provider Adapters:**

| Provider | Adapter File | Transport | OAuth Support |
|----------|-------------|-----------|---------------|
| `ollama` | `src/providers/ollama.mjs` | Native Ollama API | No |
| `nvidia` | `src/providers/openai-compatible.mjs` | OpenAI-compatible | No |
| `openrouter` | `src/providers/openai-compatible.mjs` | OpenAI-compatible | No |
| `xiaomimimo` | `src/providers/openai-compatible.mjs` | OpenAI-compatible | No |
| `openai` | `src/providers/openai-compatible.mjs` + `openai-codex-oauth.mjs` | OpenAI-native + OAuth | ✅ Yes (Codex) |

**Routing Mechanism:**
- `src/providers/index.mjs::buildProvider()` — Factory selects adapter by provider ID
- `src/models/catalog.mjs::buildModelCatalog()` — Discovers + scores available models per provider
- Model normalization strips provider prefix before sending to adapter
- Fallback model selection built into Ollama provider (`pickFallbackModel()`)

**Provider Order:** `['ollama', 'nvidia', 'openrouter', 'xiaomimimo', 'openai']`

**Strengths:**
- Clean adapter abstraction with OpenAI-compatible fallback
- OAuth support for OpenAI Codex (token-based auth)
- Automatic model discovery via `/api/tags` (Ollama) and `/models` endpoints
- Capability scoring baked into catalog (0-102 scale)

**Weaknesses:**
- No retry/backoff policy at transport layer (unlike Claw Code)
- Limited streaming tool-call argument assembly normalization
- No explicit retryable vs. non-retryable error classification

---

### Role-to-Model Mapping

**Current State:** ⚠️ **Implicit Only**

OpenUnum does **not** have an explicit role-to-model registry. Model selection is global per session:

```javascript
// Current pattern (src/server/routes/model.mjs)
POST /api/model/switch → { provider, model }
// Applies to ALL subsequent tasks
```

**Implicit Tier Assignments** (via `model-execution-envelope.mjs::inferTier()`):

| Tier | Model Patterns | Max Iterations | Max History Messages |
|------|---------------|----------------|---------------------|
| `full` | GPT-5, 405B+, 397B+, Sonnet, Opus, cloud models | 8 | 1200 |
| `balanced` | 15B-80B models | 5 | 520 |
| `compact` | nano, mini, small, 7B-14B | 3 | 220 |

**Behavior Classes** (via `model-behavior-registry.mjs`):

| Class | Default For | Tuning |
|-------|-------------|--------|
| `tool_native_strict` | OpenAI providers | 90s, 4 iters |
| `timeout_prone_deep_thinker` | NVIDIA, OpenRouter, cloud Ollama | 60s, 3 iters |
| `local_runtime_fragile` | 8B-14B local models | 180s, 6 iters |
| `planner_heavy_no_exec` | Fallback default | 120s, 6 iters |

**Gap:** No explicit mapping like "research tasks → 9B local", "code generation → 397B cloud", "file ops → any tier". Model selection is manual and global.

---

### ODD & Envelopes

**Operational Design Domain Definition:** ✅ **Implemented**

`src/core/model-execution-envelope.mjs::resolveExecutionEnvelope()` defines per-tier constraints:

**Compact Tier (≤14B models):**
- `maxHistoryMessages: 220` (reduced to 140 for ≤8B)
- `maxToolIterations: 3` (reduced to 2 for ≤8B)
- `allowedTools: VERY_SMALL_MODEL_TOOLS` (11 tools including file ops, shell, browser read-only)
- Kernel tools always included: `session_list`, `session_delete`, `session_clear`, `file_write`, `file_patch`

**Balanced Tier (15B-80B):**
- `maxHistoryMessages: 520`
- `maxToolIterations: 5`
- `allowedTools: []` (all tools permitted)

**Full Tier (≥397B or flagship):**
- `maxHistoryMessages: 1200`
- `maxToolIterations: 8`
- `allowedTools: []` (all tools permitted)

**Enforcement:**
- `src/core/agent.mjs` applies envelope at runtime
- `src/core/context-pack-builder.mjs` includes envelope metadata in system prompt
- Config override: `runtime.enforceModelExecutionProfiles` (default: true)

**Strengths:**
- Explicit parameter-based tier inference (`inferParamsB()`)
- Very-small-model special casing (≤8B gets stricter limits)
- Tool allowlisting for compact tier
- Context window scaling by tier

**Gaps:**
- No per-task-type ODD (e.g., "browser automation requires full tier")
- No latency/cost tracking per envelope
- No dynamic tier adjustment based on task complexity

---

### Capability Contracts

**Current State:** ⚠️ **Partial**

**What Exists:**
- `capability_score` (0-102) in model catalog via `modelScore()`:
  - Benchmark boost: GPT-5/Claude-3.7 = 120, Qwen397B/GLM-5 = 110, 49B = 95, 9B = 80
  - Parameter bonus: `paramsB * 0.2` (capped at 500B)
  - Context bonus: `contextWindow / 4000` (capped at 60)
- `supports_tools`, `supports_vision`, `supports_reasoning` flags per model
- `latency_tier`, `cost_tier` labels (low/medium/high)

**What's Missing:**
- No explicit capability contracts per model tier (e.g., "compact tier must achieve X% success on file ops")
- No benchmark harness for empirical scoring (scores are heuristic)
- No per-mission-type success rate tracking by model
- No degradation thresholds (when to demote a model tier)

**Proof Scoring:** ✅ Present but not model-specific
- `src/core/proof-scorer.mjs` validates completion claims (threshold: 0.6)
- Multi-factor: tool success ratio, output substance, goal alignment, error absence, verification depth
- Applied uniformly across all models

---

### Provider Agnosticism

**Current State:** ✅ **Good Foundation, Room for Hardening**

**Strengths:**
- Single `buildProvider()` factory abstracts all providers
- OpenAI-compatible adapter handles NVIDIA, OpenRouter, XiaomiMimo uniformly
- Model ID normalization strips provider prefixes consistently
- Fallback provider configuration: `config.routing.fallbackProviders`
- Behavior registry learns per-provider/model heuristics (timeout patterns, tool success rates)

**Weaknesses:**
- No canonical internal tool-call DTO (each provider gets raw tool definitions)
- Streaming tool-call argument assembly not normalized across providers
- No explicit failure taxonomy with typed recovery actions
- Fallback is provider-level only, not model-level within provider
- No provider health tracking with TTL backoff

**Comparison to Claw Code:**
Claw Code implements:
- Explicit retry policy per provider (exponential backoff, 200ms-2s, max 2 retries)
- Canonical message/tool shape with per-provider translators
- Finish-reason normalization centralized
- Retryable vs. non-retryable error classification

OpenUnum lacks these transport-layer hardening patterns.

---

### Gaps

| Gap | Severity | Impact |
|-----|----------|--------|
| **No explicit role-to-model registry** | High | Operators cannot declare "research → 9B local, code review → 397B cloud" |
| **No benchmark-driven capability scoring** | Medium | Scores are heuristic, not empirical |
| **No per-task-type ODD definitions** | Medium | Browser automation might run on compact tier unsuccessfully |
| **No transport-layer retry policy** | High | Transient API failures cause mission failures |
| **No canonical tool-call DTO** | Medium | Provider quirks can break tool parsing |
| **No provider health tracking with TTL** | Medium | Failed providers retried immediately, wasting time |
| **No mission-type proof contracts** | Medium | "Done" validation is uniform, not task-specific |
| **No dynamic tier adjustment** | Low | Task complexity doesn't escalate model tier mid-mission |

---

### Maturity Scores

| Dimension | Status | Evidence |
|-----------|--------|----------|
| **Provider/Model Support** | 🟢 Green | 5 providers, 25+ models, OAuth support, auto-discovery |
| **Role-to-Model Mapping** | 🔴 Red | No explicit registry; global model selection only |
| **ODD & Envelopes** | 🟢 Green | Tier-based execution envelopes with tool allowlisting |
| **Capability Contracts** | 🟡 Amber | Heuristic scoring exists; no empirical benchmarks or per-tier contracts |
| **Provider Agnosticism** | 🟡 Amber | Good abstraction; missing retry policy, canonical DTO, health tracking |
| **Deployability Scoring** | 🟡 Amber | `capability_score`, `latency_tier`, `cost_tier` exist but not actionable |
| **Failure Recovery** | 🟡 Amber | Behavior registry learns patterns; no typed failure taxonomy |
| **Mission Completion Contracts** | 🟡 Amber | Proof scorer validates claims; not mission-type specific |

**Overall Maturity:** 🟡 **Amber** — Strong foundation with significant hardening opportunities

---

### Recommendations

**Priority 1 (High Impact, Low Effort):**

1. **Add explicit role-to-model registry**
   - Create `src/core/role-model-registry.mjs`
   - Define roles: `research`, `code_gen`, `code_review`, `file_ops`, `browser_automation`, `planning`
   - Map each role to allowed model tiers or specific models
   - Example: `{ role: 'code_review', minTier: 'full', preferred: ['ollama/qwen3.5:397b-cloud'] }`

2. **Implement transport-layer retry policy**
   - Add `src/providers/retry-policy.mjs`
   - Classify errors: `transient`, `auth`, `not_found`, `quota`, `timeout`
   - Exponential backoff: 200ms initial, 2s max, 2 retries for transient only
   - Fast-fail on auth/not_found/quota

3. **Add provider health tracking**
   - Track per-provider failure counts with TTL (e.g., 5min backoff after 3 failures)
   - Expose via `/api/provider-health` endpoint
   - Skip unhealthy providers in fallback chain

**Priority 2 (Medium Impact, Medium Effort):**

4. **Create canonical tool-call DTO**
   - Define internal `ToolCall` and `ToolResult` schemas
   - Add per-provider translators (like Claw Code's `openai_compat.rs`)
   - Normalize streaming argument assembly
   - Centralize finish-reason mapping

5. **Build benchmark harness**
   - Create `tests/benchmarks/model-benchmark.mjs`
   - Test suite: file ops, shell commands, browser extract, code generation
   - Run per-model, store empirical success rates
   - Update `capability_score` from benchmarks, not heuristics

6. **Define mission-type proof contracts**
   - Extend `proof-scorer.mjs` with mission-type schemas
   - Example: `code_change` requires git diff + test pass; `research` requires summary + sources
   - Reject "done" claims that don't meet contract

**Priority 3 (Lower Priority, Higher Effort):**

7. **Add dynamic tier escalation**
   - Monitor iteration count and tool failure rate
   - If compact tier fails 2+ times, suggest escalation to balanced/full
   - Operator confirmation required before switching

8. **Implement per-task-type ODD**
   - Define task types: `read_only`, `file_mutation`, `shell_execution`, `browser_automation`, `network_calls`
   - Map each to minimum tier and required capabilities
   - Enforce at mission start

---

### Conclusion

OpenUnum demonstrates **strong pragmatism** in model-aware execution (tier envelopes, behavior classes, proof scoring) but lacks **explicit role-to-model mapping** and **transport-layer hardening** that would make it production-robust across heterogeneous providers.

The architecture is well-positioned for these upgrades: the provider adapter pattern, behavior registry, and execution envelope provide solid foundations. Closing the identified gaps would bring OpenUnum to parity with Claw Code-style reliability while maintaining its unique strengths in proof-aware completion and learned behavior tuning.

**Next Step:** Implement Priority 1 recommendations in sequence, starting with role-to-model registry (enables task-appropriate model selection) and retry policy (immediately improves reliability).
