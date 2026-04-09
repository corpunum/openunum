# OpenUnum Architecture

**Version:** 2.1.0  
**Last Updated:** 2026-04-05

---

## Overview

OpenUnum is an autonomous AI assistant with production-grade context engineering, hybrid memory retrieval, and robust execution tracking.

---

## Core Components

### 1. Agent Core (`src/core/agent.mjs`)
- Main orchestration loop
- Tool execution with trace tracking
- Integration with context compiler

### 2. Context Compiler (`src/core/context-compiler.mjs`)
Ordered pipeline for context assembly:
1. **Static system instructions** — Cached, rarely changes
2. **Execution state** — Semi-static (task progress, tool history)
3. **Working memory anchor** — Dynamic (origin task, plan, contract)
4. **Recalled memories** — Dynamic (from hybrid retrieval)
5. **Recent turns** — Last 4 pairs, raw

### 3. Working Memory Anchor (`src/core/working-memory.mjs`)
- Keeps original task + plan as "ghost message" on every turn
- Prevents drift in weak models (9B)
- Supports subplan tracking for multi-phase tasks

### 4. Hybrid Retriever (`src/memory/recall.mjs`)
Retrieval pipeline:
1. **BM25** — Keyword search (top-20 candidates)
2. **Embeddings** — Ollama nomic-embed-text
3. **Rerank** — Cosine similarity
4. **Return** — Top-5 with BM25 + similarity scores

Fallback: BM25-only if embeddings unavailable.

### 5. Context Compaction (`src/core/context-compact.mjs`)
Enriched artifact extraction:
- `verifiedFacts` — File creates, test passes, git commits
- `openLoops` — Unanswered questions, incomplete tasks
- `pendingSubgoals` — Unfinished phases/steps
- `failuresWithReasons` — Errors with type classification
- `producedArtifacts` — Files, code, tests, docs

### 6. Proof Scorer (`src/core/proof-scorer.mjs`)
Multi-factor validation (threshold: 0.6):
- Tool success ratio (0.25)
- Output substance (0.20)
- Goal alignment (0.20)
- Error absence (0.15)
- Verification depth (0.10) — NEW
- Claim specificity (0.10) — NEW

### 7. Execution Trace (`src/core/execution-trace.mjs`)
- Tool usage logging
- Intervention tracking
- Audit trail for all actions

---

## Data Flow

```
User Input
    ↓
Context Compiler (assembles context)
    ↓
LLM (generates response + tool calls)
    ↓
Tool Runtime (executes tools)
    ↓
Proof Scorer (validates completion)
    ↓
Response (with trace metadata)
```

---

## Memory System

### Storage Locations
- **Sessions:** `data/sessions/*.json`
- **Memories:** `data/memory/*.md` (for hybrid retrieval)
- **Working Memory:** `data/working-memory/*.json`
- **Static Cache:** `data/static-system-instructions.md`

### Embedding Model
- **Provider:** Ollama (localhost:11434)
- **Model:** nomic-embed-text
- **Dimensions:** 768

---

## Tool System

### Available Tools
- `file` — Read, write, edit, delete, list
- `git` — Status, commit, push, diff
- `browser` — Navigate, screenshot, interact
- `memory` — Store, recall, search
- `exec` — Shell commands
- `web_search` — DuckDuckGo
- `model-backed logical tools` — phase-one read-only contracts (`summarize`, `classify`, `extract`)

### Tool Runtime
- Located: `src/tools/runtime.mjs`
- Features: Argument generation, fallback handling, result compaction
- Backend substrate: `src/tools/backends/*` (registry/contracts/profiles/governor/adapters)

---

## Autonomy Enhancements

### Throttling (`src/core/autonomy-throttle.mjs`)
- Prevents runaway tool loops
- Enforces pauses between actions
- Detects and breaks cycles

### Task Decomposition (`src/core/task-decomposer.mjs`)
- Breaks large tasks into subplans
- Tracks progress per subplan
- Enables phase-based execution

---

## Configuration

### Key Files
- `openunum.json` — Runtime config
- `package.json` — Dependencies + version

### Environment Variables
```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434
OPENUNUM_PORT=18881
OPENUNUM_WORKSPACE=/home/corp-unum/openunum
```

---

## Testing

### Unit Tests
- Location: `tests/unit/`
- Coverage: Core modules, utilities

### E2E Tests
- Location: `tests/e2e/`
- Suites: File, Git, Memory, Browser, Health, Self-Healing, Multi-Step

Run: `npm test`

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.1.0 | 2026-04-05 | Hybrid retrieval, context compiler, enriched compaction, proof scorer v2 |
| 2.0.0 | 2026-03-31 | Initial modular architecture |
| 0.1.0 | 2026-03-30 | Legacy monolithic version |

---

## References

- `docs/CONTEXT_ENGINEERING.md` — Context management details
- `docs/MEMORY_SYSTEM.md` — Memory architecture
- `docs/AGENT_ONBOARDING.md` — Contributor guide
- `CHANGELOG.md` — Full changelog
