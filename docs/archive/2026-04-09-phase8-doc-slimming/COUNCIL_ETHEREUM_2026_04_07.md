## Ethereum-Inspired Architecture Evaluation

**Date:** 2026-04-07  
**Analyst:** Council Member 2 (Subagent)  
**Target:** OpenUnum v2.1.0 (`/home/corp-unum/openunum/`)

---

### Canonical State (L1)

OpenUnum's **L1 Settlement Layer** is the SQLite database (`data/openunum.db`) serving as the canonical state root. All execution outcomes ultimately settle here.

**Core Tables (State Roots):**

| Table | Purpose | Ethereum Analog |
|-------|---------|-----------------|
| `execution_state` | Unified task/mission state | Block header (state root) |
| `sessions` / `messages` | Chat history | Transaction log |
| `facts` | Key-value knowledge store | State trie (simple) |
| `tool_runs` | Tool execution receipts | Transaction receipts |
| `strategy_outcomes` | Strategy success/failure ledger | Historical state proofs |
| `session_compactions` | Context compression checkpoints | State snapshots |
| `memory_artifacts` | Enriched execution artifacts | Event logs |
| `route_lessons` | Route success/failure history | Fork choice rule data |
| `controller_behaviors` | Model-specific learned behaviors | Client diversity tracking |
| `channel_state` | External channel offsets | Cross-chain bridge state |

**Head Block Pointer:** The `execution_state` table with `ORDER BY updated_at DESC` serves as the canonical head. Each record contains:
- `status` (running/completed/failed/interrupted)
- `step` / `max_steps` (execution progress)
- `state_json` (full state snapshot)

**Session Files** (`data/sessions/*.json`) act as **off-chain storage** — indexed by L1 but not canonical.

**Working Memory** (`data/working-memory/*.json`) serves as **mempool state** — transient execution context that may or may not settle to L1.

---

### Execution Lanes (L2)

OpenUnum implements **multiple L2 execution lanes** for fast, parallelizable work:

#### 1. Mission Runner (`src/core/missions.mjs`)
- **Purpose:** Autonomous goal-driven execution
- **Lane Type:** Retryable transaction lane with circuit breakers
- **Features:**
  - Turn timeout enforcement (90s default)
  - Contract validation (proof requirements before DONE)
  - Route lesson recording (fork choice based on success rates)
  - Provider failover (cross-lane bridging)
  - Self-poke followup (post-completion optimization)

#### 2. Task Orchestrator (`src/core/task-orchestrator.mjs`)
- **Purpose:** Multi-step workflow execution
- **Lane Type:** Sequential transaction pipeline
- **Step Kinds:** `tool`, `mission`, `worker`, `self_edit`, `model_scout`, `delay`
- **Verification:** Pre-commit checks (`verify` phase) + post-commit monitoring (`monitor` phase)

#### 3. Worker Orchestrator (`src/core/worker-orchestrator.mjs`)
- **Purpose:** Scheduled/recurring tool sequences
- **Lane Type:** Cron-like execution lane
- **Features:**
  - Interval-based scheduling
  - Allowed-tools whitelist (transaction type restriction)
  - Run count limits (gas-like caps)
  - Fail counting (circuit breaker)

#### 4. Side Quests (`data/side-quests/*.json`)
- **Purpose:** Repair sub-agents spawned on tool failures
- **Lane Type:** Exception handling lane
- **Trigger:** Tool fails 2-3 times → spawn repair quest
- **Isolation:** Separate child session (sandboxed execution)

#### 5. Self-Edit Pipeline (`src/core/self-edit-pipeline.mjs`)
- **Purpose:** Autonomous code modification
- **Lane Type:** Privileged execution lane (requires validation gates)

#### 6. Model Scout Workflow (`src/core/model-scout-workflow.mjs`)
- **Purpose:** Model capability discovery
- **Lane Type:** Reconnaissance lane (read-only probes)

---

### State Diffs & Proofs

**✅ Present (Partial Implementation)**

#### Proof Scorer (`src/core/proof-scorer.mjs`)
Multi-factor validation with threshold 0.6:
- Tool success ratio (0.25)
- Output substance (0.20)
- Goal alignment (0.20)
- Error absence (0.15)
- **Verification depth** (0.10) — NEW
- **Claim specificity** (0.10) — NEW

#### Enriched Compaction Artifacts (`src/core/context-compact.mjs`)
Extracted during state transitions:
- `verifiedFacts` — Confirmed state changes (file created, tests passed, git commit)
- `openLoops` — Unresolved state (pending transactions)
- `pendingSubgoals` — Incomplete execution paths
- `failuresWithReasons` — Categorized error codes
- `producedArtifacts` — State diff outputs

#### Mission Contract Validation (`src/core/missions.mjs`)
```javascript
evaluateMissionContract({
  contract,      // Completion requirements
  replyText,     // Agent output
  checkpoint,    // State commitment
  newProof,      // Tool success delta
  localResponseProof // Runtime verification
})
```

**Contract Types:**
- `local-runtime-proof-v1` — Requires launch verification
- `coding-proof-v1` — Requires file/test evidence
- `generic-proof-v1` — Basic completion marker

#### Route Lessons (`route_lessons` table)
Historical execution path tracking:
- `route_signature` — Normalized execution path hash
- `surface` — Execution surface (shell/http/browser/file)
- `outcome` — success/failure
- `error_excerpt` — Failure reason

**Used for:** Fork choice — prefer routes with higher success rates.

#### Operation Receipts (`operation_receipts` table)
Idempotency tracking for destructive operations:
- `operation_id` — Unique operation identifier
- `result_json` — Pre/post state snapshot
- Enables replay protection

---

### Gaps

**🚨 Missing L1/L2 Patterns:**

| Gap | Severity | Description |
|-----|----------|-------------|
| **No Merkle State Roots** | High | State is flat SQLite; no cryptographic state commitments |
| **No Finality Gadget** | High | No explicit finality; `completed` status is optimistic |
| **No Slashing Conditions** | Medium | Contract violations don't penalize; just retry |
| **No Light Client Proofs** | Medium | Cannot verify state without full DB access |
| **No Cross-Lane Atomicity** | Medium | Task/Worker/Mission lanes can diverge |
| **No Gas Metering** | Low | `maxSteps` is coarse; no per-operation cost |
| **No State Expiry** | Low | Old records persist indefinitely |
| **No Validator Set** | Low | Single-agent; no consensus needed |

**Trust Economics — Missing:**
- No reputation scoring for execution paths
- No stake-weighted fork choice
- No economic incentives for honest reporting
- `route_lessons` tracks success rates but doesn't influence model selection economically

---

### Maturity Scores

| Dimension | Status | Evidence |
|-----------|--------|----------|
| **Canonical State (L1)** | 🟡 Amber | SQLite provides single state root, but no cryptographic commitments |
| **Execution Lanes (L2)** | 🟢 Green | 6 distinct lane types with clear separation of concerns |
| **State Diffs** | 🟡 Amber | Enriched artifacts captured, but not cryptographically verifiable |
| **Proof System** | 🟡 Amber | Multi-factor proof scorer exists; threshold-based but not cryptographic |
| **Finality** | 🔴 Red | No explicit finality; `completed` is optimistic, reversible on restart |
| **Trust Economics** | 🔴 Red | No penalties, no reputation, no economic incentives |
| **Head Pointer** | 🟢 Green | `execution_state.updated_at` provides clear ordering |
| **Idempotency** | 🟡 Amber | `operation_receipts` table exists but usage is partial |
| **Fork Choice** | 🟡 Amber | `route_lessons` informs route selection but not formally |

**Overall:** 🟡 **Amber** — L2 execution is mature; L1 settlement needs cryptographic hardening.

---

### Recommendations

**Priority 1 (L1 Hardening):**

1. **Add Merkle Root Computation**
   - Compute SHA-256 root over `execution_state` + `facts` tables on each state transition
   - Store in new `state_roots` table: `(block_number, state_root, parent_hash, timestamp)`
   - Enables light-client verification

2. **Implement Finality Gadget**
   - Add `finalized` boolean to `execution_state`
   - Finality triggered after N successful tool runs without reversal
   - Prevents `interrupted` status on completed work after restart

3. **Add Slashing for Contract Violations**
   - Track `contract_violations` per model/provider
   - After 3 violations: cooldown period or model blacklist
   - Record in `controller_behaviors` table

**Priority 2 (L2 Optimization):**

4. **Cross-Lane Atomicity Protocol**
   - When Task spawns Mission, link via `parent_execution_id`
   - If parent fails, child auto-cancels (atomic rollback)
   - Add foreign key constraints to `execution_state`

5. **Gas Metering**
   - Add `gas_used` to each tool run (estimated from latency + token count)
   - Track `gas_budget` per mission/task
   - Halt execution when budget exhausted

**Priority 3 (Trust Economics):**

6. **Reputation System**
   - Score routes by: `(success_count - failure_count) / total`
   - Weight recent runs higher (exponential decay)
   - Use reputation for fork choice in `deriveRuntimeHints()`

7. **Stake-Weighted Model Selection**
   - Models with higher success rates get priority in routing
   - Track `model_reputation` in `controller_behaviors`
   - Deprioritize models with repeated contract violations

**Priority 4 (Operational):**

8. **State Expiry Policy**
   - Archive `execution_state` records older than 30 days
   - Keep only `state_root` hashes for historical verification
   - Reduces DB size, improves query performance

9. **Light Client API**
   - Expose `/state/root` endpoint returning current Merkle root
   - Expose `/proof/:execution_id` returning inclusion proof
   - Enables external verification without full DB access

---

### Summary

OpenUnum has **strong L2 execution lanes** with clear separation of concerns (Missions, Tasks, Workers, Side-Quests). The **L1 settlement layer** (SQLite) provides persistence but lacks cryptographic guarantees. The **proof system** is heuristic-based rather than cryptographic.

**To reach Ethereum-level maturity:** Add Merkle state roots, implement finality, introduce economic incentives/penalties, and enable light-client verification.

**Current state:** ~60% of Ethereum-inspired patterns implemented (strong on execution, weak on cryptography/economics).
