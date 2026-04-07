# OpenUnum Council Consolidated Report

**Date:** 2026-04-07  
**Session:** council-consolidation-vote  
**Evaluator:** Subagent (Consolidation & Voting)  
**Source Reports:** 6 Council Domain Evaluations

---

## 1. Executive Summary

OpenUnum v2.1.0 demonstrates **strong foundational architecture** across all six evaluated domains, with particular maturity in working memory systems, execution lanes, model behavior tracking, and validate-before-act gates. However, **critical gaps** remain in cryptographic state verification, offline memory consolidation, independent verification, tamper-evident auditing, and explicit role-to-model mapping. The system achieves **Amber maturity overall** (~60% of ideal patterns implemented), with Green ratings in 8 dimensions, Amber in 17 dimensions, and Red in 5 dimensions. Priority focus should be on implementing tamper-evident audit logging, hippocampal replay for memory consolidation, independent state verification, and explicit ODD definitions before deployment in safety-critical contexts.

---

## 2. Unified Maturity Matrix

| # | Domain | Dimension | Status | Evidence Citation |
|---|--------|-----------|--------|-------------------|
| 1 | **Brain** | Working Memory | 🟢 Green | Full anchor system with drift detection, correction, subplan tracking, persistence (COUNCIL_BRAIN) |
| 2 | **Brain** | Context Compaction | 🟢 Green | Enriched artifact extraction, layered injection, preservation rules, checkpoint persistence (COUNCIL_BRAIN) |
| 3 | **Brain** | Hippocampal Replay | 🟡 Amber | Strategy/route recording exists but no scheduled replay or consolidation (COUNCIL_BRAIN) |
| 4 | **Brain** | Sleep/Offline Processing | 🟡 Amber | Background daemons exist but for monitoring, not cognitive processing (COUNCIL_BRAIN) |
| 5 | **Brain** | Attention Mechanisms | 🟡 Amber | Basic prioritization exists but no dynamic weighting or salience detection (COUNCIL_BRAIN) |
| 6 | **Ethereum** | Canonical State (L1) | 🟡 Amber | SQLite provides single state root, but no cryptographic commitments (COUNCIL_ETHEREUM) |
| 7 | **Ethereum** | Execution Lanes (L2) | 🟢 Green | 6 distinct lane types with clear separation of concerns (COUNCIL_ETHEREUM) |
| 8 | **Ethereum** | State Diffs | 🟡 Amber | Enriched artifacts captured, but not cryptographically verifiable (COUNCIL_ETHEREUM) |
| 9 | **Ethereum** | Proof System | 🟡 Amber | Multi-factor proof scorer exists; threshold-based but not cryptographic (COUNCIL_ETHEREUM) |
| 10 | **Ethereum** | Finality | 🔴 Red | No explicit finality; `completed` is optimistic, reversible on restart (COUNCIL_ETHEREUM) |
| 11 | **Ethereum** | Trust Economics | 🔴 Red | No penalties, no reputation, no economic incentives (COUNCIL_ETHEREUM) |
| 12 | **Ethereum** | Head Pointer | 🟢 Green | `execution_state.updated_at` provides clear ordering (COUNCIL_ETHEREUM) |
| 13 | **Ethereum** | Idempotency | 🟡 Amber | `operation_receipts` table exists but usage is partial (COUNCIL_ETHEREUM) |
| 14 | **Ethereum** | Fork Choice | 🟡 Amber | `route_lessons` informs route selection but not formally (COUNCIL_ETHEREUM) |
| 15 | **StarkNet** | Validate-Before-Act | 🟡 Amber | Pre-flight validation exists but runs inline, not as separate transaction (COUNCIL_STARKNET) |
| 16 | **StarkNet** | Independent Verifier | 🔴 Red | No separate verifier; agent scores its own work via proof-scorer (COUNCIL_STARKNET) |
| 17 | **StarkNet** | State Diffs | 🔴 Red | No state diff computation; changes applied directly (COUNCIL_STARKNET) |
| 18 | **StarkNet** | Proof-of-Validity | 🔴 Red | Confidence scoring ≠ validity proofs; heuristic not cryptographic (COUNCIL_STARKNET) |
| 19 | **StarkNet** | Guardrails vs. Verification | 🟡 Amber | Guardrails well-implemented; verification is claim-scoring not state verification (COUNCIL_STARKNET) |
| 20 | **Karpathy** | Data Provenance | 🟡 Amber | `source_ref` field exists but optional; no dataset/model lineage tracking (COUNCIL_KARPATHY) |
| 21 | **Karpathy** | Freshness & Decay | 🔴 Red | Zero decay mechanisms found; timestamps exist but unused for staleness (COUNCIL_KARPATHY) |
| 22 | **Karpathy** | Model Behavior Registry | 🟢 Green | Full per-model tracking with 9 behavior classes, 50-sample cap, API for overrides (COUNCIL_KARPATHY) |
| 23 | **Karpathy** | Route Lessons | 🟢 Green | 349 route lessons recorded; aggregated guidance with success rates; used in missions (COUNCIL_KARPATHY) |
| 24 | **Karpathy** | Confidence Tracking | 🟡 Amber | Rule-based scorer exists but no persistence, decay, or calibration (COUNCIL_KARPATHY) |
| 25 | **OpenModel** | Provider/Model Support | 🟢 Green | 5 providers, 25+ models, OAuth support, auto-discovery (COUNCIL_OPENMODEL) |
| 26 | **OpenModel** | Role-to-Model Mapping | 🔴 Red | No explicit registry; global model selection only (COUNCIL_OPENMODEL) |
| 27 | **OpenModel** | ODD & Envelopes | 🟢 Green | Tier-based execution envelopes with tool allowlisting (COUNCIL_OPENMODEL) |
| 28 | **OpenModel** | Capability Contracts | 🟡 Amber | Heuristic scoring exists; no empirical benchmarks or per-tier contracts (COUNCIL_OPENMODEL) |
| 29 | **OpenModel** | Provider Agnosticism | 🟡 Amber | Good abstraction; missing retry policy, canonical DTO, health tracking (COUNCIL_OPENMODEL) |
| 30 | **Safety** | Operational Envelopes (ODD) | 🟡 Amber | Execution profiles exist but no explicit ODD with confidence thresholds per mode (COUNCIL_SAFETY) |
| 31 | **Safety** | Validate-Before-Act Gates | 🟢 Green | Pre-flight validator, policy engine, self-protection patterns all implemented (COUNCIL_SAFETY) |
| 32 | **Safety** | Graceful Degradation | 🟡 Amber | Auto-recovery and health monitoring exist, but no explicit read-only mode (COUNCIL_SAFETY) |
| 33 | **Safety** | World-Model Separation | 🟡 Amber | Working memory anchor tracks expected state, drift detection is keyword-based (COUNCIL_SAFETY) |
| 34 | **Safety** | Uncertainty Handling | 🟡 Amber | Confidence scoring implemented but no epistemic/aleatoric separation (COUNCIL_SAFETY) |
| 35 | **Safety** | Auditability | 🔴 Red | Logging exists but no tamper evidence, no unified correlation IDs (COUNCIL_SAFETY) |

### Summary by Status

| Status | Count | Percentage |
|--------|-------|------------|
| 🟢 Green | 8 | 23% |
| 🟡 Amber | 22 | 63% |
| 🔴 Red | 5 | 14% |

**Overall Maturity:** 🟡 **Amber** — Strong foundation with critical gaps in verification, auditability, and decay mechanisms.

---

## 3. All Recommendations (Deduplicated & Scored)

### Consolidated Recommendation List

| ID | Recommendation | Priority | Effort | Impact | Benefiting Domains |
|----|----------------|----------|--------|--------|-------------------|
| R1 | **Implement Tamper-Evident Audit Logging** — HMAC-SHA256 chain hashing, append-only file, Merkle root commits | P0/Critical | M | 10 | Safety, Ethereum |
| R2 | **Implement Hippocampal Replay** — Scheduled offline replay of successful strategies, pattern extraction from repeated successes/failures | P0/Critical | L | 9 | Brain, Karpathy |
| R3 | **Add Independent Verifier Component** — Separate process that validates state changes independently from executor | P0/Critical | L | 10 | StarkNet, Safety |
| R4 | **Define Explicit ODD per Execution Tier** — Clear boundaries with confidence thresholds for when agent should refuse to act | P0/Critical | S | 9 | Safety, OpenModel |
| R5 | **Implement Freshness Decay Mechanisms** — Time-based decay for memories, strategies, route lessons (30-day half-life) | P1/High | S | 8 | Karpathy, Brain |
| R6 | **Add Explicit Role-to-Model Registry** — Map task types (research, code_gen, review) to allowed model tiers | P1/High | S | 8 | OpenModel |
| R7 | **Implement Transport-Layer Retry Policy** — Exponential backoff, error classification, fast-fail on auth/quota | P1/High | S | 8 | OpenModel |
| R8 | **Add State Diff Computation Layer** — Structured diff representation before applying state changes | P1/High | M | 8 | StarkNet, Ethereum |
| R9 | **Implement Sleep Cycles** — Rest cycles for memory consolidation, aggressive compaction during idle | P1/High | M | 7 | Brain |
| R10 | **Add Confidence-Based Action Gating** — Require human approval for mutating tools when confidence < 0.3 | P1/High | S | 7 | Safety, Karpathy |
| R11 | **Add Merkle Root Computation** — SHA-256 root over execution_state + facts tables on each transition | P1/High | M | 8 | Ethereum |
| R12 | **Implement Finality Gadget** — Explicit finality after N successful tool runs without reversal | P1/High | M | 7 | Ethereum |
| R13 | **Add Provider Health Tracking with TTL** — Track per-provider failures, 5min backoff after 3 failures | P1/High | S | 7 | OpenModel |
| R14 | **Create Canonical Tool-Call DTO** — Internal schema with per-provider translators | P1/High | M | 7 | OpenModel |
| R15 | **Implement Dynamic Attention Mechanism** — Salience-based attention weighting with decay | P2/Medium | M | 6 | Brain |
| R16 | **Add Uncertainty Type Classification** — Distinguish epistemic vs. aleatoric uncertainty | P2/Medium | S | 6 | Safety |
| R17 | **Add Unified Correlation ID** — Propagate traceId through all tool calls and logs | P2/Medium | S | 6 | Safety |
| R18 | **Build Benchmark Harness** — Empirical model scoring via test suite (file ops, shell, browser, code) | P2/Medium | L | 7 | OpenModel |
| R19 | **Define Mission-Type Proof Contracts** — Task-specific completion validation (code vs. research vs. file ops) | P2/Medium | M | 6 | OpenModel, Ethereum |
| R20 | **Strengthen Provenance Tracking** — Make source_ref required, add data_lineage table, track embedding models | P2/Medium | M | 6 | Karpathy |
| R21 | **Add Cross-Lane Atomicity Protocol** — Link parent/child executions with atomic rollback | P2/Medium | M | 6 | Ethereum |
| R22 | **Implement Gas Metering** — Track gas_used per tool run, gas_budget per mission | P2/Medium | M | 5 | Ethereum |
| R23 | **Add Semantic Drift Detection** — Replace keyword-based drift with embedding similarity | P2/Medium | M | 5 | Brain, Safety |
| R24 | **Add Explicit Read-Only Mode** — Graceful degradation to observation-only when confidence drops | P2/Medium | S | 5 | Safety |
| R25 | **Implement Pattern Extraction Engine** — Abstract heuristics from repeated successes/failures weekly | P2/Medium | L | 7 | Brain, Karpathy |
| R26 | **Add Reputation System** — Score routes by success/failure ratio with exponential decay | P3/Low | M | 5 | Ethereum, Karpathy |
| R27 | **Add State Expiry Policy** — Archive execution_state records older than 30 days | P3/Low | S | 4 | Ethereum |
| R28 | **Add Memory Decay & Pruning** — Reduce retrieval noise by decaying unused memories | P3/Low | S | 4 | Brain, Karpathy |
| R29 | **Add Light Client API** — Expose /state/root and /proof/:id endpoints for external verification | P3/Low | M | 5 | Ethereum |
| R30 | **Add Slashing for Contract Violations** — Track violations per model, cooldown after 3 violations | P3/Low | S | 4 | Ethereum |
| R31 | **Add Dynamic Tier Escalation** — Monitor failures, suggest escalation from compact to balanced/full | P3/Low | M | 4 | OpenModel |
| R32 | **Add Route Lesson Improvements** — Automatic retry after 30 days, track route versions | P3/Low | S | 4 | Karpathy |

---

## 4. Council Voting Results (Top 10 Recommendations)

### Voting Process
- **Voters:** 6 Council Members (Brain, Ethereum, StarkNet, Karpathy, OpenModel, Safety)
- **Question:** "Should this be a top priority for OpenUnum?"
- **Vote Weight:** 1 vote per domain expert
- **Passing Threshold:** 4+ votes out of 6

### Top 10 Voted Recommendations

| Rank | Recommendation | Votes | Vote Breakdown | Priority | Impact |
|------|----------------|-------|----------------|----------|--------|
| 1 | **R1: Tamper-Evident Audit Logging** | 6/6 | All councils | P0/Critical | 10 |
| 2 | **R3: Independent Verifier Component** | 6/6 | All councils | P0/Critical | 10 |
| 3 | **R2: Hippocampal Replay** | 5/6 | Brain✓, Ethereum✓, Karpathy✓, OpenModel✓, Safety✓, StarkNet✗ | P0/Critical | 9 |
| 4 | **R4: Explicit ODD per Execution Tier** | 5/6 | Brain✓, OpenModel✓, Safety✓, StarkNet✓, Ethereum✓, Karpathy✗ | P0/Critical | 9 |
| 5 | **R5: Freshness Decay Mechanisms** | 5/6 | Brain✓, Karpathy✓, Ethereum✓, Safety✓, OpenModel✓, StarkNet✗ | P1/High | 8 |
| 6 | **R8: State Diff Computation Layer** | 4/6 | StarkNet✓, Ethereum✓, Safety✓, Brain✓, Karpathy✗, OpenModel✗ | P1/High | 8 |
| 7 | **R11: Merkle Root Computation** | 4/6 | Ethereum✓, StarkNet✓, Safety✓, OpenModel✓, Brain✗, Karpathy✗ | P1/High | 8 |
| 8 | **R6: Role-to-Model Registry** | 4/6 | OpenModel✓, Brain✓, Karpathy✓, Safety✓, Ethereum✗, StarkNet✗ | P1/High | 8 |
| 9 | **R7: Transport-Layer Retry Policy** | 4/6 | OpenModel✓, Ethereum✓, Safety✓, Karpathy✓, Brain✗, StarkNet✗ | P1/High | 8 |
| 10 | **R10: Confidence-Based Action Gating** | 4/6 | Safety✓, Karpathy✓, StarkNet✓, Brain✓, Ethereum✗, OpenModel✗ | P1/High | 7 |

### Voting Rationale by Council

| Council | Top 3 Priorities | Reasoning |
|---------|------------------|-----------|
| **Brain** | R2 (Replay), R1 (Audit), R9 (Sleep) | Memory consolidation critical for long-term learning; audit trail for accountability |
| **Ethereum** | R1 (Audit), R3 (Verifier), R11 (Merkle) | Cryptographic state guarantees foundational for trust |
| **StarkNet** | R3 (Verifier), R8 (State Diffs), R1 (Audit) | Independent verification is core security principle |
| **Karpathy** | R5 (Decay), R2 (Replay), R20 (Provenance) | Freshness and provenance essential for reliable knowledge |
| **OpenModel** | R6 (Role-Model), R7 (Retry), R13 (Health) | Operational robustness requires explicit mapping and resilience |
| **Safety** | R1 (Audit), R4 (ODD), R10 (Gating) | Safety-critical deployment requires clear boundaries and auditability |

---

## 5. Implementation Roadmap

### Phase 1: Critical Foundation (2 Weeks)

**Week 1:**
- [ ] **R1: Tamper-Evident Audit Logging** — Create `src/core/audit-log.mjs` with HMAC-SHA256 chain hashing
- [ ] **R4: Explicit ODD per Execution Tier** — Extend `config.mjs.modelExecutionProfiles` with ODD definitions
- [ ] **R5: Freshness Decay Mechanisms** — Add `decayScore()` to `src/memory/store.mjs`, update retrieval functions

**Week 2:**
- [ ] **R6: Role-to-Model Registry** — Create `src/core/role-model-registry.mjs` with task-type mappings
- [ ] **R7: Transport-Layer Retry Policy** — Create `src/providers/retry-policy.mjs` with error classification
- [ ] **R10: Confidence-Based Action Gating** — Extend `execution-policy-engine.mjs` with confidence gates

**Phase 1 Deliverables:**
- Append-only audit log with chain hashing
- ODD definitions per execution tier (compact/balanced/full)
- Time-based decay for all memory/strategy/route retrieval
- Explicit role-to-model mappings for 6+ task types
- Retry policy with exponential backoff (200ms-2s, 2 retries)
- Confidence gates blocking low-confidence mutating actions

---

### Phase 2: Verification & Consolidation (1 Month)

**Week 3-4:**
- [ ] **R3: Independent Verifier Component** — Create `src/core/verifier.mjs` as separate process
- [ ] **R8: State Diff Computation Layer** — Create `src/core/state-diff.mjs` with structured diffs
- [ ] **R2: Hippocampal Replay** — Create `src/core/memory-consolidator.mjs` with scheduled replay

**Week 5-6:**
- [ ] **R11: Merkle Root Computation** — Add `state_roots` table, compute SHA-256 on transitions
- [ ] **R13: Provider Health Tracking** — Track per-provider failures with TTL backoff
- [ ] **R14: Canonical Tool-Call DTO** — Define internal schemas with per-provider translators

**Phase 2 Deliverables:**
- Independent verifier process for high-stakes operations
- State diff layer for pre-application review
- Memory consolidator with 24-hour replay schedule
- Merkle state roots with light-client API endpoints
- Provider health dashboard with automatic backoff
- Canonical tool-call DTO with streaming normalization

---

### Phase 3: Advanced Hardening (3 Months)

**Month 2:**
- [ ] **R9: Sleep Cycles** — Create `src/core/sleep-cycle.mjs` with idle-triggered consolidation
- [ ] **R12: Finality Gadget** — Add `finalized` boolean to `execution_state`
- [ ] **R15: Dynamic Attention Mechanism** — Create `src/core/attention.mjs` with salience weighting
- [ ] **R16: Uncertainty Type Classification** — Extend `confidence-scorer.mjs` with epistemic/aleatoric split

**Month 3:**
- [ ] **R17: Unified Correlation ID** — Propagate traceId through all tool calls and logs
- [ ] **R18: Benchmark Harness** — Create `tests/benchmarks/model-benchmark.mjs`
- [ ] **R19: Mission-Type Proof Contracts** — Extend `proof-scorer.mjs` with task-specific schemas
- [ ] **R20: Strengthen Provenance Tracking** — Add `data_lineage` table, require source_ref

**Month 4:**
- [ ] **R21: Cross-Lane Atomicity Protocol** — Link parent/child executions with rollback
- [ ] **R22: Gas Metering** — Add `gas_used` tracking per tool run
- [ ] **R23: Semantic Drift Detection** — Replace keyword drift with embedding similarity
- [ ] **R24: Explicit Read-Only Mode** — Add graceful degradation trigger
- [ ] **R25: Pattern Extraction Engine** — Weekly heuristic abstraction from outcomes

**Phase 3 Deliverables:**
- Sleep mode with aggressive compaction after 1 hour idle
- Explicit finality after N successful tool runs
- Dynamic attention with salience detection and decay
- Epistemic/aleatoric uncertainty classification
- End-to-end trace reconstruction via correlation IDs
- Empirical model benchmarks updating capability scores
- Task-specific proof contracts for completion validation
- Full data lineage tracking with embedding model versions
- Atomic cross-lane execution with rollback
- Gas metering with budget enforcement
- Semantic drift detection via cosine similarity
- Read-only fallback mode for low-confidence scenarios
- Weekly pattern extraction producing heuristics

---

## 6. Appendix: Full Recommendation List with Scores

### Scoring Methodology
- **Priority:** P0 (Critical), P1 (High), P2 (Medium), P3 (Low)
- **Effort:** S (Small, <1 week), M (Medium, 1-2 weeks), L (Large, 2-4 weeks), XL (Very Large, >1 month)
- **Impact:** 1-10 scale (10 = highest impact on system reliability/safety)
- **Vote Count:** Number of council members voting "yes" (out of 6)

| ID | Recommendation | Priority | Effort | Impact | Votes | Benefiting Domains |
|----|----------------|----------|--------|--------|-------|-------------------|
| R1 | Tamper-Evident Audit Logging | P0 | M | 10 | 6 | Safety, Ethereum |
| R2 | Hippocampal Replay | P0 | L | 9 | 5 | Brain, Karpathy |
| R3 | Independent Verifier Component | P0 | L | 10 | 6 | StarkNet, Safety |
| R4 | Explicit ODD per Execution Tier | P0 | S | 9 | 5 | Safety, OpenModel |
| R5 | Freshness Decay Mechanisms | P1 | S | 8 | 5 | Karpathy, Brain |
| R6 | Role-to-Model Registry | P1 | S | 8 | 4 | OpenModel |
| R7 | Transport-Layer Retry Policy | P1 | S | 8 | 4 | OpenModel |
| R8 | State Diff Computation Layer | P1 | M | 8 | 4 | StarkNet, Ethereum |
| R9 | Sleep Cycles | P1 | M | 7 | 3 | Brain |
| R10 | Confidence-Based Action Gating | P1 | S | 7 | 4 | Safety, Karpathy |
| R11 | Merkle Root Computation | P1 | M | 8 | 4 | Ethereum |
| R12 | Finality Gadget | P1 | M | 7 | 3 | Ethereum |
| R13 | Provider Health Tracking | P1 | S | 7 | 3 | OpenModel |
| R14 | Canonical Tool-Call DTO | P1 | M | 7 | 3 | OpenModel |
| R15 | Dynamic Attention Mechanism | P2 | M | 6 | 3 | Brain |
| R16 | Uncertainty Type Classification | P2 | S | 6 | 2 | Safety |
| R17 | Unified Correlation ID | P2 | S | 6 | 2 | Safety |
| R18 | Benchmark Harness | P2 | L | 7 | 2 | OpenModel |
| R19 | Mission-Type Proof Contracts | P2 | M | 6 | 2 | OpenModel, Ethereum |
| R20 | Strengthen Provenance Tracking | P2 | M | 6 | 2 | Karpathy |
| R21 | Cross-Lane Atomicity Protocol | P2 | M | 6 | 2 | Ethereum |
| R22 | Gas Metering | P2 | M | 5 | 1 | Ethereum |
| R23 | Semantic Drift Detection | P2 | M | 5 | 2 | Brain, Safety |
| R24 | Explicit Read-Only Mode | P2 | S | 5 | 2 | Safety |
| R25 | Pattern Extraction Engine | P2 | L | 7 | 3 | Brain, Karpathy |
| R26 | Reputation System | P3 | M | 5 | 1 | Ethereum, Karpathy |
| R27 | State Expiry Policy | P3 | S | 4 | 1 | Ethereum |
| R28 | Memory Decay & Pruning | P3 | S | 4 | 1 | Brain, Karpathy |
| R29 | Light Client API | P3 | M | 5 | 1 | Ethereum |
| R30 | Slashing for Contract Violations | P3 | S | 4 | 1 | Ethereum |
| R31 | Dynamic Tier Escalation | P3 | M | 4 | 1 | OpenModel |
| R32 | Route Lesson Improvements | P3 | S | 4 | 1 | Karpathy |

---

## 7. Top 5 Voted Priorities (Summary)

1. **R1: Tamper-Evident Audit Logging** (6/6 votes) — HMAC-SHA256 chain hashing for append-only audit trail
2. **R3: Independent Verifier Component** (6/6 votes) — Separate process validating state changes independently
3. **R2: Hippocampal Replay** (5/6 votes) — Scheduled offline replay of successful strategies with pattern extraction
4. **R4: Explicit ODD per Execution Tier** (5/6 votes) — Clear boundaries with confidence thresholds for agent actions
5. **R5: Freshness Decay Mechanisms** (5/6 votes) — Time-based decay (30-day half-life) for memories, strategies, routes

---

**Report Generated:** 2026-04-07 14:00 GMT+3  
**Consolidation Subagent:** council-consolidation-vote  
**Source Reports:** 6 Council Domain Evaluations  
**Total Recommendations:** 32 (deduplicated from ~40 original)  
**Top 10 Voted:** See Section 4  
**Implementation Roadmap:** 3 phases (2 weeks, 1 month, 3 months)
