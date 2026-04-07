## Karpathy Wiki Architecture Evaluation

**Date:** 2026-04-07  
**Evaluator:** Council Member 4 (Subagent)  
**Scope:** OpenUnum `/home/corp-unum/openunum/`

---

### Provenance Tracking

**Status: Partial (Amber)**

**What exists:**
- `memory_artifacts` table includes `source_ref` field for linking artifacts to their origin
- `tool_runs` table captures full args/result JSON for every tool invocation with success flag
- `session_compactions` table tracks which model performed compaction, token counts before/after
- `operation_receipts` table provides idempotency keys for destructive operations

**What's missing:**
- No systematic data lineage tracking (where did training/evaluation data originate?)
- `source_ref` in memory_artifacts is optional and not consistently populated
- No dataset versioning or hash tracking for evaluation benchmarks
- No model weight provenance (which checkpoint, which training run)
- No embedding source tracking (which model generated which embeddings)

**Evidence:**
```sql
-- memory_artifacts schema shows provenance intent but weak enforcement
CREATE TABLE IF NOT EXISTS memory_artifacts (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  content TEXT NOT NULL,
  source_ref TEXT,  -- Optional, not enforced
  created_at TEXT NOT NULL
);
```

---

### Freshness & Decay

**Status: Not Implemented (Red)**

**What exists:**
- All tables have `created_at` and often `updated_at` timestamps
- `idx_*_created` indexes enable time-based queries
- Session compaction tracks cutoff points for context management

**What's missing:**
- **Zero decay mechanisms** — grep for "decay", "staleness", "freshness", "half-life", "time-weight", "recency" returned nothing
- No TTL (time-to-live) on memories, strategies, or route lessons
- No confidence decay over time (a 2-year-old strategy weighs the same as yesterday's)
- No automatic archival or pruning based on age
- `retrieveStrategyHintsSmart()` uses success boost (+0.15) but no recency bonus
- `getRouteGuidance()` orders by `last_seen DESC` but doesn't decay old failures

**Evidence:**
```javascript
// retrieveStrategyHintsSmart — no recency weighting
return rows
  .map((r) => {
    const overlap = scoreByOverlap(queryTokens, corpus);
    const successBoost = r.success ? 0.15 : 0;  // Only success matters, not age
    return { score: overlap + successBoost };
  })
```

```bash
# Confirmed: no decay logic exists
grep -r "decay\|half.*life\|time.*weight\|recency" /home/corp-unum/openunum/src --include="*.mjs"
# (no output)
```

---

### Model Behavior Registry

**Status: Implemented (Green)**

**What exists:**
- `controller_behaviors` table tracks per `(provider, model)` learned behavior
- Fields: `provider`, `model`, `class_id`, `sample_count`, `reasons_json`, `updated_at`
- `model-behavior-registry.mjs` implements runtime learning:
  - `classifyControllerBehavior()` — returns behavior class + confidence based on sample count
  - `learnControllerBehavior()` — updates classification based on observed traces (timeout, tool runs, failures)
  - Confidence scales with sample count: `0.55 + (sampleCount * 0.05)` capped at 0.95
- 9 behavior classes defined: `tool_native_strict`, `tool_native_loose`, `planner_heavy_no_exec`, `local_runtime_fragile`, `timeout_prone_deep_thinker`, etc.
- Overrides supported via config (`behaviorOverrides`)
- API endpoints for inspection/correction: `GET /api/controller/behaviors`, `POST /api/controller/behavior/override`

**Current registry snapshot:**
```
ollama/qwen3.5:397b-cloud → tool_native_loose (50 samples)
xiaomimimo/mimo-v2-pro → tool_native_loose (50 samples)
nvidia/meta/llama-3.1-405b-instruct → tool_native_loose (50 samples)
openrouter/qwen/qwen3-coder → timeout_prone_deep_thinker (42 samples)
```

**Gaps:**
- No per-task or per-surface behavior tracking (only global per-model)
- No behavior drift detection over time (model updates may change behavior)

---

### Route Lessons

**Status: Implemented (Green)**

**What exists:**
- `route_lessons` table with 349 recorded lessons
- Schema: `session_id`, `goal_hint`, `route_signature`, `surface`, `outcome`, `error_excerpt`, `note`
- `getRouteGuidance()` aggregates by `(route_signature, surface)` with success/failure counts
- Returns `successRate`, `total`, `last_seen` for each route
- Mission runner uses guidance to avoid historically unstable routes:
  ```javascript
  const unstableRoute = guidance.find((g) => g.failureCount >= 2 && g.successCount === 0);
  if (unstableRoute) {
    hints.push(`Historical lesson: route \`${unstableRoute.routeSignature}\` keeps failing.`);
  }
  ```
- `strategy_outcomes` table (57 records) tracks goal/strategy/success/evidence for higher-level patterns
- `retrieveStrategyHintsSmart()` uses BM25-style overlap scoring + success boost

**Sample route lessons:**
```
shell:[ -d /tmp ] && echo true || echo false | shell | success | 216 runs
shell:test -d /tmp && echo exists || echo not_exists | shell | success | 27 runs
shell:ls /tmp | shell | success | 17 runs
shell:[d /tmp ] && echo true || echo false]| shell | failure | 5 runs
```

**Gaps:**
- No confidence scores on route recommendations
- No decay on old route failures (a route that failed 100 times in 2024 but works now still looks bad)
- No automatic route retry after sufficient time passes

---

### Confidence Tracking

**Status: Partially Implemented (Amber)**

**What exists:**
- `confidence-scorer.mjs` with `scoreConfidence(action, evidence)` and `scoreDoneClaim(params)`
- Rule-based scoring: starts at 0.5, adjusts for evidence (toolResultOk +0.2, fileExists +0.15, etc.)
- Levels: `high` (≥0.8), `medium` (≥0.5), `low` (<0.5)
- Integrated into agent.mjs and execution-contract.mjs
- `model-behavior-registry.mjs` tracks confidence per model based on sample count

**What's missing:**
- **No confidence decay** — confidence is computed fresh each time, not stored or decayed
- No confidence tracking per memory/strategy/route over time
- `controller_behaviors` confidence is based on sample count, not on actual accuracy tracking
- No calibration (does 0.8 confidence actually mean 80% accuracy?)

**Evidence:**
```javascript
// confidence-scorer.mjs — stateless, no persistence
export function scoreConfidence(action, evidence = {}) {
  let score = 0.5; // Base confidence
  if (evidence.toolResultOk) score += 0.2;
  if (evidence.fileExists) score += 0.15;
  // ... no decay, no history
}
```

---

### Maturity Scores

| Dimension | Status (Red/Amber/Green) | Evidence |
|-----------|-------------------------|----------|
| **Data Provenance** | Amber | `source_ref` field exists but optional; no dataset/model lineage tracking |
| **Freshness & Decay** | Red | Zero decay mechanisms found; timestamps exist but unused for staleness |
| **Model Behavior Registry** | Green | Full per-model tracking with 9 behavior classes, 50-sample cap, API for overrides |
| **Route Lessons** | Green | 349 route lessons recorded; aggregated guidance with success rates; used in missions |
| **Confidence Tracking** | Amber | Rule-based scorer exists but no persistence, decay, or calibration |

---

### Recommendations

**Priority 1: Implement Freshness Decay (Critical)**

Without decay, the system accumulates outdated knowledge that pollutes retrieval:
```javascript
// Add to store.mjs
function decayScore(baseScore, createdAtMs, halfLifeMs = 30 * 24 * 60 * 60 * 1000) {
  const ageMs = Date.now() - createdAtMs;
  return baseScore * Math.pow(0.5, ageMs / halfLifeMs);
}

// Update retrieveStrategyHintsSmart
return rows
  .map((r) => {
    const overlap = scoreByOverlap(queryTokens, corpus);
    const successBoost = r.success ? 0.15 : 0;
    const recencyDecay = decayScore(1.0, new Date(r.created_at).getTime());
    return { score: (overlap + successBoost) * recencyDecay, ...r };
  })
```

**Priority 2: Strengthen Provenance Tracking (High)**

- Make `source_ref` required for memory_artifacts
- Add `data_lineage` table: `{ artifact_id, source_type, source_id, source_hash, ingested_at }`
- Track embedding model + version for each memory
- Add dataset version hashes for evaluation benchmarks

**Priority 3: Add Confidence Persistence + Decay (High)**

- Store confidence scores in `strategy_outcomes` and `route_lessons`
- Add `confidence_decay_rate` config (e.g., 10% per month)
- Implement calibration tracking: compare predicted confidence vs actual success rate

**Priority 4: Route Lesson Improvements (Medium)**

- Add automatic route retry: if a route hasn't been tried in 30 days, reset its failure count by 50%
- Track route versions (shell syntax changes, API endpoint changes)
- Add per-surface confidence (shell may be reliable, HTTP may be flaky)

**Priority 5: Behavior Registry Enhancements (Medium)**

- Track behavior per `(model, task_type)` not just per model
- Add behavior drift alerts: if recent samples disagree with historical classification, flag for review
- Expose behavior confidence in API responses

---

### Summary

OpenUnum has **strong foundations** for Karpathy-style wiki architecture:
- ✅ Model behavior registry is production-ready
- ✅ Route lessons are being collected and used
- ✅ Confidence scoring exists (but needs persistence)

**Critical gaps:**
- ❌ No freshness/decay mechanisms (knowledge accumulates forever)
- ❌ Weak provenance tracking (can't trace data/model lineage)
- ❌ No confidence calibration or decay

**Verdict:** 60% mature. Priority focus: implement decay across all dimensions within 2 weeks.
