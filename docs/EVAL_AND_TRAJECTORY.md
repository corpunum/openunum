# Eval and Trajectory Memory System

**Version:** 1.0.0
**Last Updated:** 2026-04-20

---

## Overview

OpenUnum now has a built-in eval corpus system and trajectory memory for case-based reasoning at inference time. This enables:

1. **Eval corpus** — Load and run HuggingFace agent/tool/planner datasets through the agent, score results, and track performance.
2. **Trajectory memory** — Store successful/failed agent trajectories and retrieve similar past cases at inference time.
3. **Grading** — Multiple grading modes (exact sequence, exact set, ordered subsequence, required tools, forbidden tools, final state, proof score).
4. **Consolidation-time writes** — Trajectory memory entries are written during hippocampal replay cycles, not at runtime write-through.

---

## Eval Corpus

### Schema: `openunum.trajectory.v2`

Each eval trajectory has:

| Field | Type | Description |
|-------|------|-------------|
| `goal` | string | The user prompt/goal |
| `plan` | string | The expected plan |
| `tool_calls` | array | Observed tool calls |
| `observations` | array | Observed outputs |
| `verification` | string | Verification criteria |
| `final` | string | Expected final answer |
| `expected_tool_calls` | array | Tools that should be called |
| `expected_final` | string | Expected final answer |
| `task_type` | string | `general`, `tool_call`, `multi_turn`, `planning`, `coding`, `browser` |
| `grader_type` | string | Grading mode for this trajectory |
| `max_steps` | number | Maximum steps allowed |
| `allowed_tools` | array | Tools allowed |
| `forbidden_tools` | array | Tools that must not be used |

### Commands

```bash
# Explore HF datasets for agent/tool/planner benchmarks
pnpm hf:eval:explore

# Ingest top datasets and normalize to v2 schema
pnpm hf:eval:ingest

# Run eval trajectories through the agent
EVAL_LIMIT=5 pnpm hf:eval:run
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/eval/results` | GET | List eval results (params: `evalRunId`, `limit`) |
| `/api/eval/stats` | GET | Eval statistics by grader type and task type |
| `/api/eval/trajectory/stats` | GET | Trajectory memory statistics |

---

## Trajectory Memory

### Architecture

Trajectory memory extends the existing memory system with case-based reasoning:

```
User Query
    ↓
Context Compiler (Layer 3.5: Trajectory Retrieval)
    ↓
HybridRetriever (existing Layer 4: Recalled Memories)
    ↓
TrajectoryMemoryStore.retrieveByGoal()
    ↓
Compatibility Filtering (tool set, schema version, environment)
    ↓
Bounded Context Packet (max ~600 tokens)
```

### Storage: `trajectory_memory` table

| Column | Type | Description |
|--------|------|-------------|
| `goal_normalized` | TEXT | Normalized user goal (searchable) |
| `task_type` | TEXT | `general`, `tool_call`, `multi_turn`, `planning`, `coding`, `browser` |
| `tool_set_signature` | TEXT | Comma-sorted tool names used |
| `plan_template` | TEXT | Distilled plan skeleton (not raw prompt) |
| `tool_sequence` | TEXT | Tool call sequence |
| `success_score` | REAL | Proof score (0-1) |
| `proof_passed` | INTEGER | Whether proof scorer passed |
| `verifier_passed` | INTEGER | Whether verifier passed |
| `failure_warnings` | TEXT | What went wrong if failed |
| `schema_version` | TEXT | Tool schema version |
| `model` | TEXT | Model used |
| `consolidated_at` | TEXT | When consolidated |

### Write Gating

Trajectory memory entries are **only written during consolidation cycles**, not at runtime write-through. This prevents noise and ensures quality:

- Minimum proof score threshold (0.5)
- Verifier must pass (configurable)
- Deduplication against existing entries
- Updates only if new score exceeds existing score

### Retrieval Filtering

Before reuse, stored trajectories must pass compatibility checks:

1. **Tool set**: At least 60% of trajectory's tools must be available
2. **Schema version**: Major version must match
3. **Environment fingerprint**: Must match if stored
4. **Model**: Noted but not a hard filter

### Context Injection

The trajectory retrieval packet is injected as **Layer 3.5** in the Context Compiler — between the working memory anchor (Layer 3) and recalled memories (Layer 4). It is **never injected directly into the anchor**.

---

## Grading Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `exact_sequence` | Exact tool call order match | Strict tool-use evals |
| `exact_set` | Exact tool set (order-independent) | Tool coverage evals |
| `ordered_subsequence` | Expected sequence is subsequence of actual | Multi-step evals |
| `required_tools` | All expected tools present | Minimum coverage evals |
| `forbidden_tools` | None of the forbidden tools used | Safety evals |
| `final_state` | Proof + text overlap + verifier | General evals |
| `proof_score` | Built-in proof scorer | Agent quality evals |

Overall grade is computed as: `0.4 * proof + 0.3 * sequence + 0.3 * prerequisites`

---

## Integration Points

| Component | Integration |
|-----------|-------------|
| `ContextCompiler` | Layer 3.5 trajectory retrieval packet |
| `MemoryConsolidator` | `consolidateTrajectories()` writes during replay |
| `MemoryStore` | Schema migration for `trajectory_memory` and `eval_results` tables |
| `agent.mjs` | Trajectory context passed to `contextCompiler.compile()` |
| `server.mjs` | `/api/eval/*` routes |

---

## Files

| File | Purpose |
|------|---------|
| `src/eval/trajectory-memory.mjs` | TrajectoryMemoryStore (SQLite CRUD) |
| `src/eval/trajectory-retriever.mjs` | TrajectoryRetriever + compatibility filtering + extractTrajectoryMemory() |
| `src/eval/runner.mjs` | EvalRunner + eval_results table + storeEvalResult() |
| `src/eval/grader.mjs` | Multi-mode grading (exact, set, subsequence, required, forbidden, final, proof) |
| `src/core/context-compiler.mjs` | Layer 3.5 trajectory packet injection |
| `src/core/memory-consolidator.mjs` | `consolidateTrajectories()` for batch writes |
| `src/server/routes/eval.mjs` | API endpoints |
| `scripts/hf-eval-pipeline.mjs` | HF dataset explore/ingest/eval pipeline |
| `src/memory/store.mjs` | Schema init for new tables |
