# OpenUnum Architecture

**Version:** 2.5.2  
**Last Updated:** 2026-04-17

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
- Handles slash commands, support queries, status checks, and social/identity queries (e.g., "how smart are you?") without LLM calls
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
- Canonical storage: `OPENUNUM_HOME/audit/audit-log.jsonl`
- 3-tier HMAC secret resolution: env var > persisted random file (0600) > insecure fallback with CRITICAL warning

### 6. Autonomy Master (`src/core/autonomy-master.mjs`)
- Central coordinator for 24/7 autonomous operations
- **Heartbeat:** Periodic health checks and background maintenance
- **Sleep Cycles:** Triggers `MemoryConsolidator` (Hippocampal Replay) during idle periods
- **Consolidation Triggers:** Time-based (24h) and count-based (50 memories) in addition to sleep
- **Death-Spiral Detection:** Tracks `consecutiveNoProgressCycles`, enters degraded mode, auto-creates remediations
- **Single-flight Cycles:** overlapping runs collapse to one in-flight cycle
- **Auto-Start:** Enabled by default (`autonomyMasterAutoStart: true`)

---

## Data Flow

```
User Input
    ↓
FastPathRouter / deterministic routes → [Deterministic Reply]
    ↓
Safety Council (pre-flight ODD + tool allowlist + self-protection checks)
    ↓
Context Compiler (Assembles context via Unified Hybrid Retrieval)
    ↓
Role-Model Escalation (Check if current model meets role tier, auto-escalate if not)
    ↓
LLM (Generates Thought + Tool Calls)
    ↓
Tool Runtime (Executes tools + verifier checks + finality tracking + audit logging)
    ↓
Proof Scorer (Validates completion) + Independent Verifier (post-flight reply validation)
    ↓
Audit Log (Records task_complete state with HMAC chain)
    ↓
Response (With trace metadata + verification + finality info)
```

---

## Memory System

### Storage Locations
- **Canonical runtime memory:** `OPENUNUM_HOME/openunum.db`
- **Audit trail:** `OPENUNUM_HOME/audit/audit-log.jsonl`
- **Working Memory:** `OPENUNUM_HOME/working-memory/*.json` (repo-local `data/working-memory/*.json` is legacy fallback/debug state only)
- **Legacy/generated repo-local artifacts:** `data/*` (non-canonical unless explicitly documented)

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
- Compact envelopes are read-only by default
- Tool results receive independent verifier metadata before trace/log emission
- Finality uses stable operation keys plus persisted confirmation history; tracked destructive/write operations require `3` verified successes before `_finality.finalized=true`
- Tracked set: `file_write`, `file_patch`, `session_delete`, `session_clear`, `git_push`, `skill_uninstall`, plus `shell_run` calls containing unsafe metacharacters (`;`, `&`, `|`, backtick). Plain `shell_run` is NOT finality-tracked.
- Backend substrate: `src/tools/backends/*` (registry/contracts/profiles/governor/adapters)

---

## Autonomy Enhancements

### Bounded Health + Recovery (`src/core/self-heal.mjs`, `src/core/self-heal-orchestrator.mjs`)
- Health checks are parallel and time-bounded
- `/api/health` is a service wrapper and no longer re-enters self-heal via HTTP
- `/api/health/check` is the strict health-status endpoint
- Browser/CDP degradation remains a subsystem issue and feeds autonomy remediation

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
OPENUNUM_WORKSPACE=$PWD
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
