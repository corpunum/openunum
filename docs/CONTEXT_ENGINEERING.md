# Context Engineering in OpenUnum

**Version:** 2.1.0  
**Last Updated:** 2026-04-05

---

## The Problem

LLM agents suffer from **context drift**: as conversations grow, models lose track of:
- Original task intent
- Agreed plan and constraints
- Critical decisions made early
- Verification requirements

Weak models (9B) drift after 3-4 turns (~3K tokens). Strong models (400B) drift after 20-30 turns (~24K tokens).

---

## Our Solution: Layered Context Management

OpenUnum uses a **tiered injection strategy** with 5 layers:

### Layer 1: Static System Instructions (Cached)
**Purpose:** Core identity and principles that never change  
**Size:** ~800 tokens  
**Update frequency:** Rarely (only on config changes)

```
# OpenUnum System Instructions

## Role
You are OpenUnum, an autonomous AI assistant...

## Core Principles
1. Be genuinely helpful, not performatively helpful
2. Have opinions
3. Be resourceful before asking
...
```

**Location:** `data/static-system-instructions.md`

---

### Layer 2: Execution State (Semi-Static)
**Purpose:** Where we are in the task right now  
**Size:** ~200-400 tokens  
**Update frequency:** Every turn

Includes:
- Task ID
- Current step / total steps
- Completed steps count
- Failed steps count
- Recent tool history (last 5)
- Current subplan (if multi-phase)

**Example:**
```
## Execution State
**Task ID**: task_12345
**Progress**: Step 3/8
**Completed**: 2 steps
**Recent Tools**: file.write, exec, git.status
```

---

### Layer 3: Working Memory Anchor (Dynamic)
**Purpose:** Prevent drift by keeping origin task + plan always visible  
**Size:** ~400-800 tokens  
**Update frequency:** Set on turn 1, updated on subplan changes

Structure:
```
## Working Memory Anchor

### Original Task
[User's exact request]

### Agreed Plan
[Agent's initial plan or decomposed steps]

### Success Contract
**Success**: [Criteria]
**Forbidden Drift**: [List]
**Required Outputs**: [List]

### Subplans (2/5)
→ Phase 2: Implement hybrid retrieval
  Phase 3: Build context compiler
  ...
```

**Location:** `src/core/working-memory.mjs`

**Why it works:** Even if the model "forgets" turn 1, the anchor reinjects it on every turn.

---

### Layer 4: Recalled Memories (Dynamic)
**Purpose:** Bring relevant past context into current turn  
**Size:** ~500-1500 tokens (varies)  
**Update frequency:** Every turn (retrieval runs fresh)

Retrieval pipeline:
1. **BM25** — Keyword search across all memories (top-20)
2. **Embeddings** — Generate query + candidate embeddings
3. **Rerank** — Cosine similarity scoring
4. **Return** — Top-5 with dual scores (BM25 + similarity)

**Example output:**
```
## Recalled Memories

### Memory 1 (similarity: 0.847)
**ID**: parabolic-strategy-decision
[Content from earlier session about strategy choices]

### Memory 2 (similarity: 0.712)
**ID**: lexihedge-v2-validation
[Content about validation results]
```

**Location:** `src/memory/recall.mjs`

---

### Layer 5: Recent Turns (Raw)
**Purpose:** Full detail for immediate context  
**Size:** ~800-2000 tokens (last 4 turn pairs)  
**Update frequency:** Every turn (sliding window)

Keeps last 4 user+assistant message pairs **verbatim** — no compaction, no summarization.

**Why 4 turns?** Empirical testing showed:
- 2 turns: Not enough context for multi-step reasoning
- 4 turns: Sweet spot for most tasks
- 8+ turns: Diminishing returns, high token cost

---

## Context Compaction

When sessions exceed ~12 turns, older messages are compacted:

### Basic Artifacts (Always Extracted)
- `constraint` — User requirements (must/require/never)
- `failure` — Error mentions
- `file_ref` — File paths mentioned

### Enriched Artifacts (Phase 7+)
- `verifiedFacts` — Confirmed statements (file created, tests passed, git commit)
- `openLoops` — Unanswered questions, incomplete tasks
- `pendingSubgoals` — Unfinished phases/steps
- `failuresWithReasons` — Errors with type classification
- `producedArtifacts` — Files, code, tests, docs

**Compaction output:**
```
SESSION COMPACTION CHECKPOINT (older messages summarized):
USER: Build a hybrid retrieval system with BM25 + embeddings
ASSISTANT: Starting with BM25 implementation...

[Enriched Artifacts]
- verifiedFacts: ["File created: src/memory/embeddings.mjs"]
- openLoops: ["Unanswered: Should we use reranking?"]
- pendingSubgoals: ["Phase 5: Hybrid Retrieval Pipeline"]
- failuresWithReasons: ["Tool invocation failed: timeout"]
- producedArtifacts: ["File: /path/to/embeddings.mjs", "Code block"]
```

**Location:** `src/core/context-compact.mjs`

---

## Token Budget Management

### Target Budgets by Model Class

| Model Class | Static | Execution | Anchor | Memories | Recent | Total |
|-------------|--------|-----------|--------|----------|--------|-------|
| Weak (9B) | 800 | 200 | 400 | 500 | 800 | 2,700 |
| Mid (70B) | 800 | 300 | 600 | 1000 | 1200 | 3,900 |
| Strong (400B) | 800 | 400 | 800 | 1500 | 2000 | 5,500 |

### Dynamic Adjustment

The Context Compiler adjusts based on remaining budget:
- If over budget: Reduce memories first, then recent turns
- If under budget: Expand recent turns before memories
- Static + Anchor are **never** compacted (too critical)

**Location:** `src/core/context-budget.mjs`

---

## Model Behavior Registry

Different models have different quirks:

```javascript
// Learned behaviors per model
{
  "qwen3.5:9b-64k": {
    driftTurns: 4,
    needsAnchor: true,
    prefersStructured: true
  },
  "qwen3.5:397b-cloud": {
    driftTurns: 25,
    needsAnchor: false,
    prefersStructured: false
  }
}
```

The registry learns from execution traces and adjusts injection strategy.

**Location:** `src/core/model-behavior-registry.mjs`

---

## Best Practices

### For Users
1. **Be specific in origin task** — The anchor preserves your exact words
2. **State success criteria explicitly** — Goes into the contract
3. **List forbidden drift** — Tell the agent what NOT to do

### For Developers
1. **Test with weak models** — If it works on 9B, it works everywhere
2. **Log context budgets** — Track what's actually sent to the LLM
3. **Verify anchor persistence** — Check that origin task survives 20+ turns

---

## References

- `src/core/context-compiler.mjs` — Main compiler
- `src/core/working-memory.mjs` — Anchor system
- `src/core/context-compact.mjs` — Compaction with enriched artifacts
- `src/memory/recall.mjs` — Hybrid retrieval
- `docs/ARCHITECTURE.md` — System overview
