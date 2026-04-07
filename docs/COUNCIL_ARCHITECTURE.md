# Council Architecture

**Version:** 1.0.0  
**Date:** 2026-04-07  
**Status:** ✅ Validated — 6 Domain Experts, 35 Dimensions Assessed

---

## Overview

The OpenUnum Council is a **multi-domain validation framework** that evaluates system architecture against established patterns from distributed systems, AI safety, and cognitive science. Each council member represents a distinct domain expert perspective.

The council does **not** execute code or make runtime decisions. It is a **design-time validation tool** used to:
- Identify architectural gaps before implementation
- Score maturity across critical dimensions
- Generate prioritized remediation roadmaps
- Ensure alignment with industry best practices

---

## The 7 Council Members

### 1. 🧠 Council Brain (Cognitive Architecture)

**Domain:** Memory systems, context management, attention mechanisms, learning loops

**Evaluates:**
- Working memory anchor system
- Context compaction and artifact extraction
- Hippocampal replay (scheduled consolidation)
- Sleep/offline processing cycles
- Dynamic attention weighting

**Key Findings (2026-04-07):**
| Dimension | Status | Notes |
|-----------|--------|-------|
| Working Memory | 🟢 Green | Full anchor system with drift detection |
| Context Compaction | 🟢 Green | Enriched artifacts, layered injection |
| Hippocampal Replay | 🟡 Amber | Strategy recording exists, no scheduled replay |
| Sleep/Offline | 🟡 Amber | Background daemons exist, not cognitive processing |
| Attention | 🟡 Amber | Basic prioritization, no dynamic weighting |

**Top Recommendations:**
1. Implement hippocampal replay for scheduled strategy consolidation
2. Add sleep cycles with aggressive compaction during idle
3. Implement dynamic attention with salience detection

---

### 2. ⛓️ Council Ethereum (Execution Architecture)

**Domain:** State management, execution lanes, finality, trust economics

**Evaluates:**
- Canonical state (L1) with cryptographic commitments
- Execution lane separation (L2)
- State diffs and proof systems
- Finality gadgets and idempotency
- Fork choice rules

**Key Findings (2026-04-07):**
| Dimension | Status | Notes |
|-----------|--------|-------|
| Canonical State (L1) | 🟡 Amber | SQLite provides state root, no crypto commitments |
| Execution Lanes (L2) | 🟢 Green | 6 distinct lane types with clear separation |
| State Diffs | 🟡 Amber | Artifacts captured, not cryptographically verifiable |
| Proof System | 🟡 Amber | Multi-factor scorer, not cryptographic |
| Finality | 🔴 Red | No explicit finality; `completed` is optimistic |
| Trust Economics | 🔴 Red | No penalties, reputation, or incentives |
| Head Pointer | 🟢 Green | `execution_state.updated_at` provides ordering |
| Idempotency | 🟡 Amber | `operation_receipts` exists, partial usage |
| Fork Choice | 🟡 Amber | `route_lessons` informs selection, not formal |

**Top Recommendations:**
1. Implement tamper-evident audit logging with HMAC-SHA256 chain hashing
2. Add Merkle root computation over state tables on each transition
3. Implement finality gadget after N successful tool runs

---

### 3. 🔐 Council StarkNet (Verification Architecture)

**Domain:** Independent verification, validate-before-act, state proofs

**Evaluates:**
- Validate-before-act gates
- Independent verifier component
- State diff computation
- Proof-of-validity (STARK-style)
- Guardrails vs. verification separation

**Key Findings (2026-04-07):**
| Dimension | Status | Notes |
|-----------|--------|-------|
| Validate-Before-Act | 🟡 Amber | Pre-flight validation exists, runs inline |
| Independent Verifier | 🔴 Red | No separate verifier; agent scores own work |
| State Diffs | 🔴 Red | No state diff computation; changes applied directly |
| Proof-of-Validity | 🔴 Red | Confidence scoring ≠ validity proofs |
| Guardrails vs. Verification | 🟡 Amber | Guardrails implemented; verification is claim-scoring |

**Top Recommendations:**
1. Create independent verifier component as separate process
2. Add state diff computation layer for pre-application review
3. Strengthen validate-before-act to run as separate transaction

---

### 4. 📊 Council Karpathy (Data & Learning)

**Domain:** Data provenance, freshness, model behavior tracking, route learning

**Evaluates:**
- Data provenance and lineage tracking
- Freshness and decay mechanisms
- Model behavior registry
- Route lessons and pattern extraction
- Confidence tracking and calibration

**Key Findings (2026-04-07):**
| Dimension | Status | Notes |
|-----------|--------|-------|
| Data Provenance | 🟡 Amber | `source_ref` exists but optional |
| Freshness & Decay | 🔴 Red | Zero decay mechanisms; timestamps unused |
| Model Behavior Registry | 🟢 Green | Full per-model tracking with 9 behavior classes |
| Route Lessons | 🟢 Green | 349 lessons recorded; aggregated with success rates |
| Confidence Tracking | 🟡 Amber | Rule-based scorer, no persistence or calibration |

**Top Recommendations:**
1. Implement freshness decay (30-day half-life) for memories/strategies
2. Strengthen provenance tracking (require `source_ref`, add `data_lineage` table)
3. Add pattern extraction engine for weekly heuristic abstraction

---

### 5. 🤖 Council OpenModel (Model Operations)

**Domain:** Provider abstraction, model routing, execution envelopes, ODD

**Evaluates:**
- Provider/model support and discovery
- Role-to-model mapping registry
- Operational Design Domain (ODD) definitions
- Capability contracts and benchmarks
- Provider agnosticism and retry policies

**Key Findings (2026-04-07):**
| Dimension | Status | Notes |
|-----------|--------|-------|
| Provider/Model Support | 🟢 Green | 5 providers, 25+ models, OAuth support |
| Role-to-Model Mapping | 🔴 Red | No explicit registry; global selection only |
| ODD & Envelopes | 🟢 Green | Tier-based execution envelopes with tool allowlisting |
| Capability Contracts | 🟡 Amber | Heuristic scoring, no empirical benchmarks |
| Provider Agnosticism | 🟡 Amber | Good abstraction; missing retry policy, health tracking |

**Top Recommendations:**
1. Add explicit role-to-model registry (task type → allowed model tiers)
2. Define explicit ODD per execution tier with confidence thresholds
3. Implement transport-layer retry policy with exponential backoff

---

### 6. 🛡️ Council Safety (Safety & Alignment)

**Domain:** Operational envelopes, uncertainty handling, auditability, graceful degradation

**Evaluates:**
- Operational Design Domain (ODD) definitions
- Validate-before-act gates
- Graceful degradation modes
- World-model separation
- Uncertainty type classification
- Auditability and trace reconstruction

**Key Findings (2026-04-07):**
| Dimension | Status | Notes |
|-----------|--------|-------|
| ODD | 🟡 Amber | Execution profiles exist, no explicit confidence thresholds |
| Validate-Before-Act | 🟢 Green | Pre-flight validator, policy engine, self-protection |
| Graceful Degradation | 🟡 Amber | Auto-recovery exists, no explicit read-only mode |
| World-Model Separation | 🟡 Amber | Working memory tracks expected state, drift is keyword-based |
| Uncertainty Handling | 🟡 Amber | Confidence scoring, no epistemic/aleatoric separation |
| Auditability | 🔴 Red | Logging exists, no tamper evidence or correlation IDs |

**Top Recommendations:**
1. Implement tamper-evident audit logging (shared with Ethereum council)
2. Add confidence-based action gating for low-confidence mutating actions
3. Implement explicit read-only mode for graceful degradation

---

## Council Interaction Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Council Coordinator                       │
│  (orchestrates evaluation, consolidates reports, votes)     │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Council       │  │   Council       │  │   Council       │
│   Brain         │  │   Ethereum      │  │   StarkNet      │
│   (Cognitive)   │  │   (Execution)   │  │   (Verification)│
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Council       │  │   Council       │  │   Council       │
│   Karpathy      │  │   OpenModel     │  │   Safety        │
│   (Data/Learn)  │  │   (Operations)  │  │   (Alignment)   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │  Consolidated Report │
                   │  + Priority Votes    │
                   │  + Roadmap           │
                   └─────────────────────┘
```

### Evaluation Flow

1. **Coordinator spawns** 6 domain-specific subagents
2. **Each council member** evaluates ~5-7 dimensions in their domain
3. **Individual reports** generated with Green/Amber/Red ratings
4. **Consolidation agent** deduplicates recommendations, scores priority
5. **Voting round** — each council votes on top 10 recommendations
6. **Final report** includes maturity matrix, voted priorities, phased roadmap

---

## Validation Results Summary (2026-04-07)

### Overall Maturity

| Status | Count | Percentage |
|--------|-------|------------|
| 🟢 Green | 8 | 23% |
| 🟡 Amber | 22 | 63% |
| 🔴 Red | 5 | 14% |

**Overall:** 🟡 **Amber** — Strong foundation with critical gaps in verification, auditability, and decay mechanisms.

### Top 5 Voted Priorities

| Rank | Recommendation | Votes | Priority | Impact |
|------|----------------|-------|----------|--------|
| 1 | Tamper-Evident Audit Logging | 6/6 | P0/Critical | 10 |
| 2 | Independent Verifier Component | 6/6 | P0/Critical | 10 |
| 3 | Hippocampal Replay | 5/6 | P0/Critical | 9 |
| 4 | Explicit ODD per Execution Tier | 5/6 | P0/Critical | 9 |
| 5 | Freshness Decay Mechanisms | 5/6 | P1/High | 8 |

---

## Using the Council

### Running a Full Evaluation

```bash
# Run all 6 council evaluations
node scripts/council-run-all.mjs

# Run specific council
node scripts/council-brain.mjs
node scripts/council-ethereum.mjs
node scripts/council-starknet.mjs
node scripts/council-karpathy.mjs
node scripts/council-openmodel.mjs
node scripts/council-safety.mjs

# Consolidate and vote
node scripts/council-consolidate.mjs
```

### Output Artifacts

| File | Description |
|------|-------------|
| `docs/COUNCIL_BRAIN_YYYY-MM-DD.md` | Brain domain evaluation |
| `docs/COUNCIL_ETHEREUM_YYYY-MM-DD.md` | Ethereum domain evaluation |
| `docs/COUNCIL_STARKNET_YYYY-MM-DD.md` | StarkNet domain evaluation |
| `docs/COUNCIL_KARPATHY_YYYY-MM-DD.md` | Karpathy domain evaluation |
| `docs/COUNCIL_OPENMODEL_YYYY-MM-DD.md` | OpenModel domain evaluation |
| `docs/COUNCIL_SAFETY_YYYY-MM-DD.md` | Safety domain evaluation |
| `docs/COUNCIL_CONSOLIDATED_YYYY-MM-DD.md` | Full consolidated report |

---

## Council vs. Runtime

**Important:** The council is a **design-time validation tool**, not a runtime component.

| Aspect | Council | Runtime System |
|--------|---------|----------------|
| When | Pre-deployment, periodic audits | Every agent turn |
| Purpose | Evaluate architecture, find gaps | Execute user tasks |
| Output | Reports, recommendations, roadmaps | Chat responses, tool results |
| Frequency | On-demand (weekly/monthly) | Continuous |

The council does **not**:
- Block deployments automatically
- Make runtime decisions
- Modify agent behavior directly

The council **does**:
- Provide prioritized remediation plans
- Score architectural maturity
- Ensure alignment with best practices

---

## References

- `scripts/council-*.mjs` — Council evaluation scripts
- `docs/COUNCIL_CONSOLIDATED_2026_04_07.md` — Latest consolidated report
- `docs/PHASE4_PLAN.md` — Remediation implementation plan
- `docs/PROJECT_STATE_SNAPSHOT.md` — Current system state

---

**Maintainer:** OpenUnum Team  
**Next Evaluation:** 2026-04-14 (weekly cadence recommended)
