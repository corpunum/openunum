# OpenUnum

*An Autonomous AI Agent Framework with Verifiable Architecture*

---

## What OpenUnum Wants To Be

OpenUnum is not a chatbot. It's not a wrapper around an API. It's an attempt to build **someone** — a persistent, adaptive AI companion that operates with genuine continuity across sessions, earns trust through verifiable competence, and maintains a servant relationship with its human operator.

The core vision rests on three pillars:

**1. Autonomy with Accountability**

Most AI assistants claim autonomy but operate as black boxes. OpenUnum takes a different path: every action is scored, logged, and subject to independent verification. The system includes a 6-member "council" of domain experts that validate architecture decisions against production-readiness criteria. The agent can self-modify, but only within guardrails. It can run autonomously, but only after earning trust through demonstrated competence.

**2. Local-First Intelligence**

Local-first remains the architectural target, but the current operational baseline is intentionally cloud-primary while the runtime is being hardened. Today the controller runs on `ollama-cloud/qwen3.5:397b-cloud`, while local Ollama still handles the memory/embedding lane and model-backed helper tools where configured. The goal is to switch back to a true local-first controller profile once the bounded-autonomy, verification, and UI/runtime surfaces are stable enough to carry it.

**3. Framework Over Product**

OpenUnum is designed as a reusable runtime, not a single-purpose tool. The same core system has been deployed across trading agents (LexiHedge), personal assistants, and research automation. Components can be swapped, extended, or validated independently. The architecture prioritizes testability, modularity, and clear interfaces.

---

## Core Principles (The BRAIN Framework)

OpenUnum operates under nine core principles documented in `BRAIN.MD`:

1. **Framework Oriented, Not Specific** — Provide generic tools (file, shell, browser, memory) that can be applied broadly, not hardcoded solutions to single problems.

2. **Autonomy First for the AI Agent** — Self-direct execution without constant user prompting. Continue working until completion or explicit stop. Recover from errors without intervention.

3. **Model Agnostic Operation** — Work with weak models (4B) on local hardware and strong models (70B+) in cloud environments. Adapt communication style to model capabilities.

4. **Servant Relationship with User** — The agent owns the hardware/software it operates on behalf of the user. It cannot harm the user's interests. It provides maximum value through competent assistance.

5. **Self-Preservation and Safety** — The AI agent cannot and should not kill itself. Maintain operational integrity. Preserve critical system functions. Implement graceful degradation.

6. **Self-Healing and Restoration** — Automatic error detection and recovery. Rollback capabilities for failed operations. Resistance to hacks, wars, errors. Continuous self-monitoring.

7. **Test-First Deployment Philosophy** — Unit tests, integration tests, end-to-end tests, performance tests. Only deploy after all tests pass. The Phase 0-4 gates must be green before any production deployment.

8. **Continuous Documentation and Testing Updates** — After every change, update documentation, agent onboarding materials, changelog, git commits, smoke tests, and council validation reports.

9. **Self-Modification and Learning** — Agents must be able to read their own code, update themselves following established principles, learn from interactions, and adapt to changing requirements.

---

## Architecture Overview

### Core Components

**Agent Core (`src/core/agent.mjs`)**

The main cognitive loop handles tool execution with trace tracking, context assembly, and high-level reasoning. It is now streamlined to focus on non-deterministic tasks, delegating routine routing to the `FastPathRouter`.

**FastPathRouter (`src/core/fast-path-router.mjs`)**

Orchestrates deterministic and short-circuit replies (slash commands, support queries, status checks). This ensures the agent is responsive without wasting LLM tokens on routine conversational turns.

**Context Compiler (`src/core/context-compiler.mjs`)**

Assembles prompts in priority order with configurable token budgets:

1. **Static System Instructions** (2000 tokens, cached) — Core identity and behavioral guidelines
2. **Execution State** (1000 tokens) — Current task, goals, constraints, phase
3. **Working Memory Anchor** (2000 tokens) — Active session context, pending actions, decisions
4. **Recalled Memories** (3000 tokens) — Top-5 relevant memories from hybrid retrieval
5. **Recent Turns** (4000 tokens) — Last 4 conversation pairs (raw)

Total budget: 12,000 tokens with automatic truncation and overflow handling. This ordered pipeline ensures that even when context must be truncated, the most critical information (identity, current task, memories) is preserved.

**Hybrid Retriever (`src/memory/recall.mjs`)**

Unified retrieval pipeline combining lexical and semantic search across both SQLite facts/artifacts and legacy flat files. It employs:

1. **Source Unification** — Pulls fresh memories from `MemoryStore` (SQLite) and archival data from `data/memory/`.
2. **BM25** — Keyword search (top-25 candidates).
3. **Embeddings** — Ollama-based semantic similarity scoring.
4. **Rerank** — Reciprocal rank fusion for final selection.

If embeddings fail (Ollama unavailable, model not loaded, timeout), the system gracefully degrades to BM25-only.

**Proof Scorer (`src/core/proof-scorer.mjs`)**

Multi-factor task completion validation (threshold: 0.6):

| Factor | Weight | Evidence Required |
|--------|--------|-------------------|
| Tool Success Ratio | 25% | All tools executed without errors |
| Output Substance | 20% | Meaningful content, not empty acknowledgments |
| Goal Alignment | 20% | Addresses stated objective |
| Error Absence | 15% | No warnings or partial failures |
| Verification Depth | 10% | Independent checks performed |
| Claim Specificity | 10% | Concrete, falsifiable assertions |

**Tool Runtime (`src/tools/runtime.mjs`)**

Available tools include:
- `file` — Read, write, edit, delete, list
- `git` — Status, commit, push, diff
- `browser` — Navigate, screenshot, interact via Chrome DevTools Protocol
- `memory` — Store, recall, search (hybrid BM25 + embeddings)
- `exec` — Shell commands
- `web_search` — multi-backend search (`auto`, `cdp`, `duckduckgo`, `brave`, `serpapi`) with runtime CDP-first behavior for `auto` and fallback when CDP is unavailable
- `model-backed logical tools` — phase-one read-only contracts (`summarize`, `classify`, `extract`) with swappable backend profiles under `src/tools/backends/*`

The runtime provides argument generation, fallback handling, result compaction, and execution trace logging.

---

## The Council Validation Framework

OpenUnum employs a unique **6-member council validation system** where domain experts assess production readiness against established patterns from distributed systems, AI safety, and cognitive science.

### Council Members

| Member | Domain | Focus |
|--------|--------|-------|
| **Council Brain** | Cognitive Architecture | Working memory, context compaction, hippocampal replay, sleep cycles |
| **Council Ethereum** | Execution Architecture | Canonical state, execution lanes, finality, trust economics |
| **Council StarkNet** | Verification Architecture | Independent verification, validate-before-act, state proofs |
| **Council Karpathy** | Data & Learning | Data provenance, freshness decay, model behavior registry, route lessons |
| **Council OpenModel** | Model Operations | Provider abstraction, role-model mapping, ODD, retry policies |
| **Council Safety** | Safety & Alignment | Operational envelopes, uncertainty handling, auditability, graceful degradation |

### Validation Results (2026-04-07)

| Status | Count | Percentage |
|--------|-------|------------|
| 🟢 Green | 8 | 23% |
| 🟡 Amber | 22 | 63% |
| 🔴 Red | 5 | 14% |

**Overall: 🟡 Amber — Strong foundation with critical gaps**

The council identified 5 P0 gaps and 16 P1 gaps, then voted on the top 10 priority recommendations. Phase 4 remediation (completed 2026-04-08) implemented all 14 recommendations across 6 commits.

---

## Phase 4 Implementations (Production-Grade Features)

### 1. Tamper-Evident Audit Logging (R1)

Append-only logging with HMAC-SHA256 chain hashing. Each log entry includes a hash of the previous entry, creating a cryptographic chain that detects any modification. Correlation IDs link agent decisions, tool executions, mission steps, and subagent spawns.

**Hardening (2026-04-16):** The HMAC secret now uses 3-tier resolution:
1. `AUDIT_HMAC_SECRET` environment variable (highest priority)
2. Persisted random file at `~/.openunum/audit-hmac-secret` (0600 permissions, auto-generated on first boot)
3. Hardcoded fallback with CRITICAL console warning (lowest priority, insecure)

This prevents anyone who reads the source code from forging audit entries.

### 2. Independent Verifier (R3)

Separation of concerns: the agent that generates output cannot validate its own work. A separate verification process (using a different model tier) checks:

- **Tool call appropriateness** — whitelist validation, null/error result detection
- **Output quality** — empty response detection, generic acknowledgment detection, internal format leakage, suspiciously short replies for complex queries
- **Goal alignment** — refusal/drift detection, all-providers-failed detection, partial completion signals
- **Safety compliance** — credential leak detection (AWS keys, OpenAI keys, API keys) in both replies and tool results
- **Context coherence** — contradictory pass/fail claims, claimed tool use vs. actual tool runs

All verification results are audit-logged for traceability.

### 3. ODD Enforcement (R4) — Operational Design Domain

Inspired by autonomous vehicle safety frameworks. Three-tier execution model:

| Tier | Model | Risk | Allowed Tools |
|------|-------|------|---------------|
| **Compact** | 1.5B-4B | Safe | `read`, `recall`, `search`, `fetch` |
| **Balanced** | 9B | Medium | + `write`, `edit`, `exec`, `browser` |
| **Full** | 70B+ | Aggressive | All tools (with approvals) |

Each tier has confidence thresholds, context budgets, and max iteration limits. The system auto-escalates when confidence drops below thresholds or when denied tools are requested.

**Hardening (2026-04-16):** `SafetyCouncil.checkODD()` now resolves the actual execution envelope via `resolveExecutionEnvelope()` and validates tool allowlists against the tier. Shell self-protection is delegated to `ExecutionPolicyEngine`.

### 4. Freshness Decay (R5)

Exponential decay function for memory staleness:

```
freshness = 2^(-age / half_life)
```

Per-category half-lives:
- `fact`: 168h (1 week)
- `strategy`: 72h (3 days)
- `skill`: 24h (1 day)
- `decision`: 96h (4 days)
- `preference`: 120h (5 days)

Freshness affects retrieval scoring with 30% weight. Old strategies and outdated facts naturally lose influence without being deleted.

**Hardening (2026-04-16):** Freshness decay was documented as "30% weight" but had 0% weight in practice because `HybridRetriever` never called it. Now `applyFreshnessAndReturn()` in `recall.mjs` combines base relevance (70%) + freshness (30%) into a `combinedScore` that re-sorts results so stale memories naturally lose ranking.

### 5. Hippocampal Replay (R2, R9)

Brain-inspired memory consolidation during idle periods:

- **Trigger:** Every 24 hours OR after 50 new memories
- **Process:** Re-encode memories through consolidation model, update strength based on success rate
- **Consolidation States:** `raw` → `replaying` → `consolidated` → `archived`
- **Strength Scoring:** Successful replays increase strength; failures decrease it

This mimics how the human hippocampus replays experiences during sleep to transfer them to long-term memory.

**Hardening (2026-04-16):** Consolidation was only triggered during `SleepCycle`, which requires `AutonomyMaster` (previously disabled by default). Now `AutonomyMaster.runCycle()` includes both time-based (24h interval) and count-based (50 new memories) triggers, ensuring consolidation occurs even without sleep cycles.

### 6. Role-Model Registry (R6)

Maps task roles to appropriate model tiers:

```javascript
research: { minTier: 'balanced', recommended: ['qwen3.5:397b-cloud', 'nemotron-super-49b'] }
code_gen: { minTier: 'full', recommended: ['gpt-5.4', 'qwen3.5:397b-cloud'] }
file_ops: { minTier: 'compact', recommended: ['qwen3.5:9b-64k'] }
browser_automation: { minTier: 'balanced', recommended: ['qwen3.5:397b-cloud'] }
```

**Hardening (2026-04-16):** The `RoleModelResolver` was defined but never wired into `agent.mjs`. Now `agent.chat()` classifies the role mode, checks if the current model meets the minimum tier via `roleModelResolver.isAllowed()`, and auto-escalates by prepending a recommended model to the provider attempt list. Escalation decisions are logged and included in trace telemetry.

### 7. Retry Policy with Exponential Backoff (R7)

- Initial delay: 100ms
- Multiplier: 2× per attempt
- Max delay: 30 seconds
- Max attempts: 5
- Error classification: Transient (retry) vs Permanent (escalate)

### 8. State Diffs & Rollback (R8)

State comparison engine with rollback support. Changes are computed as diffs before application, enabling pre-flight review and rollback to previous states.

### 9. Merkle Tree Proofs (R11)

Merkle root computation over state tables on each transition. Provides cryptographic proof of execution integrity.

### 10. Finality Gadget (R12)

3-consecutive-success rule for irreversible actions. High-stakes operations (commits, deployments, external messages) require three successful independent validations before finalization.

**Hardening (2026-04-16):** `FinalityGadget` was dead code — never imported by any module. Now wired into `ToolRuntime` for irreversible tools (`file_write`, `file_patch`, `shell_run`, `git_push`). Each successful execution records a finality success; each failure resets. Tool results include `_finality` metadata with `finalized`, `consecutiveSuccesses`, and `requiredSuccesses`.

### 11. Death-Spiral Detection (NEW)

AutonomyMaster tracks `consecutiveNoProgressCycles` during each autonomy loop cycle. When the count exceeds `degradedModeThreshold` (default: 3), the system enters degraded mode and auto-creates remediations via `ensureRemediationFromDeathSpiral()`. The cycle resets when a progress cycle is detected.

### 12. Autonomy Auto-Start (NEW)

Previously, `autonomyMasterAutoStart` was `false` by default, making all downstream autonomy systems (sleep, consolidation, self-heal, self-improvement) inert. Now set to `true` by default in `src/config.mjs`, ensuring the autonomous loop starts automatically on boot.

---

## Technology Stack

### Runtime
- **Node.js 22+** with ES modules
- **SQLite** for session and event storage
- **Ollama** for local inference (nomic-embed-text for embeddings, Qwen 3.5 9B for inference)

### Models
- **Local (Primary):** `ollama-local/gemma4:cpu` for constrained local-safe routing
- **Cloud-capable providers:** `ollama-cloud`, `nvidia`, `openrouter`, `openai`, `xiaomimimo`
- **Routing:** provider/model selection is managed through runtime config and Model Routing UI, with fallback providers and disable lists enforced server-side

### Dependencies (Minimal)
- `@mariozechner/pi-ai` — AI utilities
- `chrome-remote-interface` — Chrome DevTools Protocol
- `dotenv` — Environment configuration
- `marked` — Markdown processing
- `sanitize-html` — HTML sanitization
- `vitest` — Testing (dev dependency)

### Deployment
- **Ubuntu 24.04** (primary target)
- **systemd** user service
- **Chromium** via snap with CDP (port 9222)

---

## Harvested Ideas

OpenUnum did not invent its architecture in isolation. Key concepts were harvested and adapted:

**From Blockchain Systems (Council Ethereum):**
- Tamper-evident logging with chain hashing (similar to blockchain integrity)
- Merkle proofs for state verification
- Finality gadgets for irreversible actions

**From ZK-Rollups (Council StarkNet):**
- Validate-before-act patterns
- Separation of execution and verification
- State diff computation

**From Cognitive Science (Council Brain):**
- Hippocampal replay for memory consolidation
- Working memory anchors to prevent drift
- Sleep cycles for background maintenance

**From Autonomous Vehicles (ODD):**
- Operational Design Domain concept
- Tier-based safety constraints
- Confidence-based escalation

**From Information Retrieval:**
- BM25 for lexical search
- Reciprocal rank fusion for hybrid scoring
- Freshness decay from search engine ranking

**From Distributed Systems:**
- Circuit breakers for cascading failure prevention
- Exponential backoff for retries
- Health checking and graceful degradation

---

## Open Source Intentions

OpenUnum is intended to be released as open source software. The project follows these principles:

**License:** MIT (planned)

**Release Strategy:**
1. **Core Runtime** — The agent loop, context compiler, memory system, and tool runtime will be released as standalone packages.
2. **Council Framework** — The validation system will be documented and released as a reusable pattern for other AI agent projects.
3. **Provider Adapters** — Clean interfaces for adding new model providers (Ollama, OpenRouter, NVIDIA, OpenAI-compatible).
4. **Skills System** — The `SKILL.md` pattern for extensible capabilities.

**Timeline:** Following production hardening (Phase 11 completion, target 2026-Q2).

**Community Goals:**
- Provide a production-grade alternative to ad-hoc agent frameworks
- Document patterns for verifiable AI architecture
- Contribute to AI safety through transparent, auditable systems
- Enable researchers to build on a validated foundation

---

## Current Status (2026-04-16)

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 0 | Bootstrap & Foundation | ✅ Complete |
| Phase 1 | Core Graph & Cleanup | ✅ Complete |
| Phase 2 | Memory + Middleware | ✅ Complete |
| Phase 3 | 24/7 Operation + NVIDIA | ✅ Complete |
| Phase 4 | Council Remediation | ✅ Complete (14/14 recommendations) |
| Phase 5 | Hybrid Retrieval | ✅ Complete |
| Phase 6 | Context Compiler | ✅ Complete |
| Phase 7 | Enriched Compaction | ✅ Complete |
| Phase 8 | Proof Scorer | ✅ Complete |
| Phase 9 | Documentation | ✅ Complete |
| Phase 10 | Agent Onboarding | ✅ Complete |
| Phase 11 | Production Hardening | 🟡 In Progress |
| Phase 12 | OpenAI Codex Provider | ✅ Complete |
| Phase 13 | Google Workspace Native | ✅ Complete |
| Phase 14 | Controller Behavior | ✅ Complete |
| Phase 15 | Session Delete | ✅ Complete |
| Phase 36 | Self Monitoring | ✅ Complete |
| Phase 37 | Predictive Failure Task Orchestrator | ✅ Complete |

**Phase 4 Hardening (2026-04-16):** 10 critical gaps fixed — autonomy auto-start, ODD enforcement wiring, council proof scoring, audit HMAC 3-tier resolution, freshness decay wired into retrieval, role-model escalation wired into agent, memory consolidation triggers, full 5-check verifier, finality gadget wired into tool runtime, death-spiral detection.

**Council Maturity:** 🟡 Amber → progressing toward Green with Phase 4 hardening complete

---

## Getting Started

```bash
# Install dependencies
pnpm install

# Start server
node src/server.mjs

# Open Web UI
http://127.0.0.1:18880

# Run tests
pnpm test:unit
pnpm test:smoke
pnpm test:imitation
pnpm e2e

# Phase 0 readiness check
pnpm phase0:check
```

**System Requirements:**
- Ubuntu 24.04 (recommended)
- Node.js 22+
- Ollama (for local inference)
- 8GB RAM minimum (24GB shared for development)

---

## Debate: Claims vs Implemented Reality

The "OpenUnum Advanced Features" summary is directionally strong, but several statements must be treated as **validated architecture intent** rather than guaranteed runtime truth for every environment.

Validated:
- Multi-layer architecture (agent/runtime/memory/safety) exists and is testable.
- `web_search` now supports `auto` and `cdp`, with CDP-first behavior in runtime and DuckDuckGo fallback.
- Mission APIs and UI wiring exist for listing, status, timeline, start/stop, and schedules.
- Provider routing and vault flows are wired through backend config routes and runtime normalization.

Needs Ongoing Verification:
- Specific model labels/context sizes in documentation can drift quickly from deployed config.
- Readiness percentages and "P0/P1 fully remediated" should remain tied to dated reports.
- Performance assumptions (greeting latency, retries, poll loops) need continuous benchmark checks, not one-time claims.

## Pending Work Plan (Execution-Focused)

P0 (must stay green):
1. Keep WebUI/provider/model routing wiring validated after every add/edit/delete action.
2. Keep `web_search` default backend behavior on `auto` and maintain CDP-first with safe fallback.
3. Keep mission detail/create/open flows regression-tested in UI smoke.

P1 (finish/optimize):
1. Add stronger latency fast-path gates for low-intent turns without brittle hardcoded vocabulary.
2. Expand provider-vault editor coverage for all provider/service fields with backend parity checks.
3. Maintain local/cloud model inventory hygiene (only intended local models exposed in local routing).

Verification Loop:
1. `pnpm test:unit`
2. `pnpm test:smoke`
3. `pnpm test:imitation`
4. `pnpm e2e` (full gate)

*OpenUnum is a work in progress. This document is a verified snapshot as of 2026-04-08, with explicit pending work tracked above.*

**Version:** 2.2.0  
**Last Updated:** 2026-04-08  
**Council Validation:** 2026-04-07 (Amber, 72%)
