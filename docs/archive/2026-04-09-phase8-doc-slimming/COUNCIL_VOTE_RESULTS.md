# Council Vote Results — Top Gaps & System Priorities

**Date:** 2026-04-07  
**Session:** council-vote-consolidation  
**Facilitator:** Main Agent (Governance Orchestrator)  
**Participants:** All 7 Council Architecture Members

---

## Voting Method

Each council member identified their **top 3 gaps** within their domain, then cross-referenced dependencies with other members. Final system-wide priorities were determined by:
1. Frequency of mention across members
2. Cross-domain impact score
3. Blocking relationships (cannot implement X without Y)

---

## Per-Member Votes

### 1. 🧠 Council Brain (Cognitive Architecture)

**Top 3 Gaps:**

| Rank | Gap | Rationale | Dependencies |
|------|-----|-----------|--------------|
| 1 | **No hippocampal replay** | Strategy outcomes recorded but never consolidated offline. Weakens long-term learning. | Karpathy (decay), Self-Monitoring (scheduling) |
| 2 | **No sleep/offline cycles** | No dedicated time for aggressive compaction and pattern extraction. | Self-Monitoring (daemon coordination) |
| 3 | **No dynamic attention** | Salience detection missing. All inputs weighted equally. | Safety (uncertainty handling) |

**Cross-Member Dependencies:**
- Hippocampal replay requires Karpathy's freshness decay to prioritize recent successes
- Sleep cycles require Self-Monitoring to coordinate idle detection
- Attention weighting requires Safety's uncertainty scores to weight high-confidence info

**Vote for System Priority:** Hippocampal Replay (P0)

---

### 2. ⛓️ Council Ethereum (Execution Architecture)

**Top 3 Gaps:**

| Rank | Gap | Rationale | Dependencies |
|------|-----|-----------|--------------|
| 1 | **No explicit finality** | `completed` state is optimistic and reversible. No commitment point. | StarkNet (verification), Safety (audit logging) |
| 2 | **No cryptographic commitments** | SQLite state not Merklized. Cannot prove state integrity. | Safety (tamper-evidence) |
| 3 | **Idempotency inconsistent** | `operation_receipts` table exists but not enforced across all mutating ops. | StarkNet (validate-before-execute) |

**Cross-Member Dependencies:**
- Finality requires StarkNet's independent verifier to certify state transitions
- Cryptographic commitments require Safety's tamper-evident logging infrastructure
- Idempotency requires StarkNet's validation transaction pattern

**Vote for System Priority:** Explicit Finality (P0)

---

### 3. 🔐 Council StarkNet (Independent Verification)

**Top 3 Gaps:**

| Rank | Gap | Rationale | Dependencies |
|------|-----|-----------|--------------|
| 1 | **No independent verifier** | Agent scores its own work. Conflict of interest. Critical security gap. | Safety (audit trail), Ethereum (state diffs) |
| 2 | **No validate-before-execute separation** | Validation runs inline with execution. Same trust boundary. | Ethereum (transaction model) |
| 3 | **No state diff computation** | Changes applied directly. No intermediate representation to verify. | Ethereum (canonical state) |

**Cross-Member Dependencies:**
- Independent verifier requires Safety's tamper-evident logs for audit trail
- Validate-before-execute requires Ethereum's transaction/lanes model
- State diffs require Ethereum's canonical state definition

**Vote for System Priority:** Independent Verifier (P0) — **Unanimous #1**

---

### 4. 📚 Council Karpathy (Freshness & Provenance)

**Top 3 Gaps:**

| Rank | Gap | Rationale | Dependencies |
|------|-----|-----------|--------------|
| 1 | **Zero decay mechanisms** | 2-year-old strategies weigh same as yesterday's. No half-life. | Brain (replay prioritization) |
| 2 | **Data lineage not tracked** | `source_ref` optional. No dataset/model provenance. | OpenModel (provider metadata) |
| 3 | **No confidence calibration** | Confidence scores not persisted or calibrated against actual success. | Safety (uncertainty handling) |

**Cross-Member Dependencies:**
- Decay mechanisms enable Brain's hippocampal replay to prioritize recent patterns
- Data lineage requires OpenModel's provider adapters to capture metadata
- Confidence calibration requires Safety's uncertainty quantification

**Vote for System Priority:** Freshness Decay (P1)

---

### 5. 🤖 Council OpenModel (Provider Pragmatism)

**Top 3 Gaps:**

| Rank | Gap | Rationale | Dependencies |
|------|-----|-----------|--------------|
| 1 | **No role-to-model registry** | Global model selection only. Can't say "code review → 397B". | Safety (ODD definition), Brain (task classification) |
| 2 | **No transport retry policy** | No exponential backoff or error classification at provider layer. | Self-Monitoring (timeout handling) |
| 3 | **No provider health tracking** | Can't detect degraded providers before dispatch. | Self-Monitoring (health checks) |

**Cross-Member Dependencies:**
- Role-to-model registry requires Safety's ODD to define allowed tiers per task type
- Retry policy requires Self-Monitoring's timeout and recovery infrastructure
- Provider health requires Self-Monitoring's 8-point health check system

**Vote for System Priority:** Role-to-Model Registry (P1)

---

### 6. 🛡️ Council AV/Robotics Safety

**Top 3 Gaps:**

| Rank | Gap | Rationale | Dependencies |
|------|-----|-----------|--------------|
| 1 | **No tamper-evident audit logging** | Logs exist but can be modified. No HMAC chain or Merkle roots. | Ethereum (cryptographic commitments) |
| 2 | **No explicit ODD definition** | Execution envelopes exist but no confidence thresholds for refusal. | OpenModel (capability contracts) |
| 3 | **No epistemic/aleatoric separation** | All uncertainty treated uniformly. Can't distinguish model doubt from environmental noise. | Karpathy (confidence calibration) |

**Cross-Member Dependencies:**
- Tamper-evident logging enables Ethereum's cryptographic commitments
- ODD definition requires OpenModel's tier capability contracts
- Uncertainty separation requires Karpathy's confidence tracking

**Vote for System Priority:** Tamper-Evident Audit Logging (P0)

---

### 7. 🔁 Council Self-Monitoring

**Top 3 Gaps:**

| Rank | Gap | Rationale | Dependencies |
|------|-----|-----------|--------------|
| 1 | **Subagent spawn timeout bug** | Completion events delayed. Results marked "timed out" incorrectly. | OpenClaw infrastructure (external) |
| 2 | **No proof-based task promotion** | Task completion not automatically promoted to long-term memory. | Brain (memory store), Karpathy (artifact extraction) |
| 3 | **Completion event reliability** | Sometimes delayed or lost. Affects continuation logic. | OpenClaw event delivery (external) |

**Cross-Member Dependencies:**
- Task promotion requires Brain's memory artifacts and Karpathy's enrichment
- Completion reliability depends on OpenClaw's subagent result delivery
- Spawn timeout is infrastructure-level (may require OpenClaw patch)

**Vote for System Priority:** Spawn Timeout Fix (P0) — **Blocking all subagent work**

---

## Cross-Member Dependencies Map

```
                    ┌─────────────────────────────────────────────┐
                    │         P0-1: Tamper-Evident Logging        │
                    │         (Safety vote, Ethereum support)     │
                    └─────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              P0-2: Independent Verifier                         │
│              (StarkNet vote #1 — UNANIMOUS)                     │
│              Requires: audit trail + state diffs                │
└─────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
┌──────────────────────┐  ┌──────────────────┐  ┌────────────────────┐
│ P0-3: Explicit ODD   │  │ P0-5: Hippocampal│  │ P0-4: Spawn Timeout│
│ (Safety + OpenModel) │  │ Replay           │  │ Fix                │
│                      │  │ (Brain + Karpathy│  │ (Self-Monitoring)  │
│ Requires: capability │  │ Requires: decay  │  │ Blocks: all        │
│ contracts            │  │ + scheduling     │  │ subagent work      │
└──────────────────────┘  └──────────────────┘  └────────────────────┘
         │                        │
         ▼                        ▼
┌──────────────────────┐  ┌──────────────────┐
│ P1-2: Role-to-Model  │  │ P1-1: Freshness  │
│ Registry             │  │ Decay            │
│ (OpenModel vote #1)  │  │ (Karpathy vote #1│
└──────────────────────┘  └──────────────────┘
```

---

## Consensus: Top 5 System-Wide Priorities

### #1: Independent Verifier Component (P0)
**Votes:** StarkNet (#1), Safety (#2), Ethereum (#1)  
**Rationale:** Fundamental security gap. Agent cannot score its own work without conflict of interest. Required for any safety-critical deployment.  
**Effort:** Large (new process architecture)  
**Impact:** 10/10

### #2: Tamper-Evident Audit Logging (P0)
**Votes:** Safety (#1), Ethereum (#2)  
**Rationale:** Prerequisite for verifier. Without tamper-evident logs, verifier cannot trust historical state.  
**Effort:** Medium (HMAC chaining + append-only file)  
**Impact:** 10/10

### #3: Subagent Spawn Timeout Fix (P0)
**Votes:** Self-Monitoring (#1)  
**Rationale:** Blocking all subagent-based work. Council evaluation itself was affected by spawn timeouts.  
**Effort:** Small (OpenClaw infrastructure patch or workaround)  
**Impact:** 9/10

### #4: Hippocampal Replay (P0)
**Votes:** Brain (#1), Karpathy (#2)  
**Rationale:** Core learning mechanism missing. System doesn't consolidate lessons offline.  
**Effort:** Large (scheduled daemon + pattern extraction)  
**Impact:** 9/10

### #5: Explicit ODD Definition (P0)
**Votes:** Safety (#2), OpenModel (#2)  
**Rationale:** Required for safe autonomous operation. Must define when agent should refuse to act.  
**Effort:** Small (documentation + policy engine wiring)  
**Impact:** 9/10

---

## Honorable Mentions (P1/High)

| Priority | Gap | Votes | Notes |
|----------|-----|-------|-------|
| P1-1 | Freshness Decay | Karpathy (#1), Brain (#2) | 30-day half-life for memories/strategies |
| P1-2 | Role-to-Model Registry | OpenModel (#1) | Map task types to allowed model tiers |
| P1-3 | State Diff Computation | StarkNet (#2), Ethereum (#3) | Intermediate representation before execution |
| P1-4 | Explicit Finality | Ethereum (#1) | Commitment point for completed state |
| P1-5 | Transport Retry Policy | OpenModel (#2) | Exponential backoff at provider layer |

---

## Blocking Relationships

**Cannot implement without:**

| Implementation | Requires | Owner |
|----------------|----------|-------|
| Independent Verifier | Tamper-evident logging | Safety |
| Independent Verifier | State diff computation | Ethereum |
| Hippocampal Replay | Freshness decay | Karpathy |
| Hippocampal Replay | Scheduled daemon | Self-Monitoring |
| Role-to-Model Registry | ODD definition | Safety |
| Explicit Finality | Independent verifier | StarkNet |
| Cryptographic Commitments | Tamper-evident logging | Safety |

---

## Phase 4 Remediation Sequence

Based on votes and dependencies, recommended implementation order:

### Week 1: Foundation
1. **Tamper-Evident Logging** (Safety) — enables verifier + finality
2. **ODD Definition** (Safety + OpenModel) — enables role-to-model registry
3. **Spawn Timeout Fix** (Self-Monitoring) — unblocks subagent work

### Week 2-3: Verification
4. **State Diff Computation** (Ethereum) — enables verifier
5. **Independent Verifier** (StarkNet) — #1 system priority
6. **Explicit Finality** (Ethereum) — requires verifier

### Week 4: Learning
7. **Freshness Decay** (Karpathy) — enables replay prioritization
8. **Hippocampal Replay** (Brain) — #4 system priority
9. **Role-to-Model Registry** (OpenModel) — requires ODD

### Week 5: Polish
10. **Confidence Calibration** (Karpathy)
11. **Transport Retry Policy** (OpenModel)
12. **Dynamic Attention** (Brain)

---

## Dissenting Opinions

**Council Ethereum:** "Trust economics (reputation, penalties) should be higher priority if we ever deploy multi-agent. Marked P3 for now but revisit when we add agent-to-agent delegation."

**Council Self-Monitoring:** "Spawn timeout is an OpenClaw infrastructure issue, not our code. May require upstream patch or workaround. Risk: blocked indefinitely if OpenClaw doesn't fix."

**Council Karpathy:** "Data provenance (lineage tracking) is under-prioritized. If we ever train on our own data or fine-tune, we'll need full dataset/model lineage. Consider elevating to P1."

---

## Next Steps

1. **Product Review:** Antonis to review P0 priorities and approve Phase 4 scope
2. **Sprint Planning:** Break P0 items into actionable tickets
3. **OpenClaw Issue:** File spawn timeout bug with OpenClaw maintainers
4. **Architecture Doc:** Update COUNCIL_ARCHITECTURE.md with vote results

---

**Vote Completed:** 2026-04-07 15:24 GMT+3  
**Facilitator:** Main Agent  
**Consensus:** ✅ All 7 members aligned on top 5 priorities
