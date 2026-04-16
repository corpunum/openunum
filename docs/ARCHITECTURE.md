# OpenUnum Architecture

**Version:** 2.5.0  
**Last Updated:** 2026-04-16

---

## Overview

OpenUnum is an autonomous AI assistant with production-grade context engineering, unified hybrid memory retrieval, and a cryptographically verifiable audit trail.

---

## Core Components

### 1. Agent Core (`src/core/agent.mjs`)
- Main cognitive loop (Context → Thought → Action → Verification)
- Streamlined to focus on non-deterministic reasoning
- Integrated with `FastPathRouter` for routine turn offloading

### 2. FastPathRouter (`src/core/fast-path-router.mjs`)
- Orchestrates deterministic and short-circuit replies
- Handles slash commands, support queries, and status checks without LLM calls
- Reduces latency and token waste for routine conversational turns

### 3. Context Compiler (`src/core/context-compiler.mjs`)
Ordered pipeline for context assembly:
1. **Static system instructions** — Cached, rarely changes
2. **Execution state** — Semi-static (task progress, tool history)
3. **Working memory anchor** — Dynamic (origin task, plan, contract)
4. **Recalled memories** — Dynamic (from unified hybrid retrieval)
5. **Recent turns** — Last 4 pairs, raw

### 4. Hybrid Retriever (`src/memory/recall.mjs`)
Unified retrieval pipeline:
1. **Source Unification** — Pulls from both SQLite `MemoryStore` and legacy flat files
2. **BM25** — Keyword search (top-25 candidates)
3. **Embeddings** — Ollama nomic-embed-text semantic similarity
4. **Rerank** — Reciprocal rank fusion
5. **Freshness Decay** — 30% weight on combined score via `applyFreshnessAndReturn()`
6. **Return** — Top-8 with BM25 + similarity + freshness scores

### 5. Audit Log (`src/core/audit-log.mjs`)
- Tamper-evident HMAC-SHA256 chain hashing
- Logs every tool execution and critical mission state change
- Provides a cryptographically verifiable history of agent actions
- 3-tier HMAC secret resolution: env var > persisted random file (0600) > insecure fallback with CRITICAL warning

### 6. Autonomy Master (`src/core/autonomy-master.mjs`)
- Central coordinator for 24/7 autonomous operations
- **Heartbeat:** Periodic health checks and background maintenance
- **Sleep Cycles:** Triggers `MemoryConsolidator` (Hippocampal Replay) during idle periods
- **Consolidation Triggers:** Time-based (24h) and count-based (50 memories) in addition to sleep
- **Death-Spiral Detection:** Tracks `consecutiveNoProgressCycles`, enters degraded mode, auto-creates remediations
- **Auto-Start:** Enabled by default (`autonomyMasterAutoStart: true`)

---

## Data Flow

```
User Input
    ↓
FastPathRouter (Short-circuit check) → [Deterministic Reply]
    ↓
Context Compiler (Assembles context via Unified Hybrid Retrieval)
    ↓
Role-Model Escalation (Check if current model meets role tier, auto-escalate if not)
    ↓
LLM (Generates Thought + Tool Calls)
    ↓
Tool Runtime (Executes tools + Finality checks for irreversible ops + Logs to Audit Trail)
    ↓
Proof Scorer (Validates completion) + Independent Verifier (5-check validation)
    ↓
Safety Council (ODD enforcement via execution envelope tier allowlists)
    ↓
Audit Log (Records task_complete state with HMAC chain)
    ↓
Response (With trace metadata + verification + finality info)
```

---

## Memory System

### Storage Locations
- **Sessions:** `data/sessions/*.json`
- **Memories:** `data/memory/*.md` (for hybrid retrieval)
- **Working Memory:** `OPENUNUM_HOME/working-memory/*.json` (repo-local `data/working-memory/*.json` is legacy fallback/debug state only)
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
- Finality: `FinalityGadget` checks for irreversible tools (`file_write`, `file_patch`, `shell_run`, `git_push`)
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
| 2.5.0 | 2026-04-16 | Phase 4 hardening: autonomy auto-start, ODD enforcement, full verifier, freshness in retrieval, role-model escalation, finality gadget, death-spiral detection, audit HMAC 3-tier, consolidation triggers |
| 2.4.0 | 2026-04-15 | Council validation, session sweep, UI decomposition |
| 2.1.0 | 2026-04-05 | Hybrid retrieval, context compiler, enriched compaction, proof scorer v2 |
| 2.0.0 | 2026-03-31 | Initial modular architecture |
| 0.1.0 | 2026-03-30 | Legacy monolithic version |

---

## References

- `docs/CONTEXT_ENGINEERING.md` — Context management details
- `docs/MEMORY_SYSTEM.md` — Memory architecture
- `docs/AGENT_ONBOARDING.md` — Contributor guide
- `docs/CHANGELOG_CURRENT.md` — Current consolidated changelog
