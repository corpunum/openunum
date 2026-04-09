## AV/Robotics Safety Evaluation

**Date:** 2026-04-07  
**Evaluator:** Council Member 6 (Subagent)  
**Scope:** OpenUnum Core Safety Patterns  
**Files Analyzed:** `src/core/guardrails.mjs` (not found), `src/core/proof-scorer.mjs`, `src/core/self-monitor.mjs`, `src/core/execution-contract.mjs`, `src/core/tool-validator.mjs`, `src/core/preflight-validator.mjs`, `src/core/confidence-scorer.mjs`, `src/core/execution-policy-engine.mjs`, `src/core/auto-recover.mjs`, `src/core/selfheal.mjs`, `src/core/working-memory.mjs`, `src/core/agent.mjs`, `src/logger.mjs`, `src/config.mjs`

---

### Current Safety Mechanisms

| Mechanism | Implementation | Status |
|-----------|----------------|--------|
| **Proof Scoring** | `proof-scorer.mjs` — Multi-factor validation (tool success ratio, output substance, goal alignment, error absence, verification depth, claim specificity). Threshold: 0.6 for "done" claims. | ✅ Implemented |
| **Pre-Flight Validation** | `preflight-validator.mjs` — Schema validation for 25+ tools (required args, types, dangerous patterns). Auto-correction for common mistakes. | ✅ Implemented |
| **Post-Execution Validation** | `tool-validator.mjs` — Validates results after execution (error detection, empty results, exit codes). | ✅ Implemented |
| **Self-Protection Policy** | `execution-policy-engine.mjs` — Blocks self-destruct commands (`pkill openunum`, `rm -rf`, `git reset --hard`, fork bombs). Denies mutating tools in plan mode. | ✅ Implemented |
| **Auto-Recovery** | `auto-recover.mjs` — 20+ recovery handlers (browser CDP, provider timeout, shell failures, file not found, disk space, database locks, mission stuck, agent loops). | ✅ Implemented |
| **Health Monitoring** | `selfheal.mjs` — 8-point health checks (config, disk, memory, browser CDP, provider, server, logs, skills). Auto-heal on failures. | ✅ Implemented |
| **Continuation Enforcement** | `self-monitor.mjs` + `execution-contract.mjs` — Prevents premature completion, forces continuation when proof score < 0.6. | ✅ Implemented |
| **Drift Detection** | `working-memory.mjs` — Detects topic drift from original task, generates correction prompts. | ✅ Implemented |

---

### Separation Assessment

| Dimension | Implementation | Assessment |
|-----------|----------------|------------|
| **World-Model Separation** | `working-memory.mjs` — Anchor system maintains expected state (user origin, agreed plan, success criteria, subplans). Compacted middle turns with pointers to full history. | ⚠️ Partial — Expected vs. actual state tracked via task steps, but no explicit drift quantification beyond keyword matching |
| **Independent Verification** | `proof-scorer.mjs` — Shadow scoring compares current decision against evidence. `scoreProofQuality()` runs independently of agent's own completion claim. | ✅ Implemented — Verification depth scoring checks for verification language and result interpretation |
| **State Consistency Checks** | `task-tracker.mjs` (absorbed into working-memory) — Tracks step completion state, validates all steps complete before allowing done claim. | ✅ Implemented — `areAllStepsComplete()` enforces step verification |
| **Plan vs. Execution Separation** | `execution-policy-engine.mjs` — Plan mode blocks mutating tools, allows only recovery tools. Clear separation between planning and execution phases. | ✅ Implemented |

**Gap:** No explicit world-model drift detection with quantitative thresholds (e.g., "expected state X, observed state Y, drift = Z%"). Current drift detection is keyword-based.

---

### Uncertainty Handling

| Aspect | Implementation | Assessment |
|--------|----------------|------------|
| **Confidence Scoring** | `confidence-scorer.mjs` — Rule-based scoring (tool result ok, file exists, http success, data returned, exit code zero). Levels: high (≥0.8), medium (≥0.5), low (<0.5). | ✅ Implemented |
| **Proof-Based Confidence** | `proof-scorer.mjs` — Multi-factor scoring with breakdown. Returns `confident: bool` based on 0.6 threshold. Breakdown includes: tool success, output substance, goal alignment, no errors, verification depth, claim specificity. | ✅ Implemented |
| **Epistemic vs. Aleatoric** | ❌ Not distinguished — All uncertainty treated uniformly. No separation between model uncertainty (epistemic) and environmental noise (aleatoric). | ❌ Missing |
| **Action Rules by Confidence** | `self-monitor.mjs` — Low confidence (<0.6) triggers continuation. `confidence-scorer.mjs` — Low confidence recommends "Verify with another tool before declaring complete". | ⚠️ Partial — Recommendations exist but not enforced as hard gates |
| **Fallback on Low Confidence** | `provider-fallback-policy.mjs` — Falls back to alternative providers on timeout/failure. `auto-recover.mjs` — Recovers from model/provider issues. | ✅ Implemented — But not explicitly tied to confidence scores |

**Gap:** No explicit epistemic/aleatoric uncertainty separation. No confidence-based action gating (e.g., "confidence < 0.3 → require human approval before mutating action").

---

### Audit Trail

| Aspect | Implementation | Assessment |
|--------|----------------|------------|
| **Logging** | `logger.mjs` — JSON-structured logs (info, error, warn, debug, health, self-heal). Written to `~/.openunum/logs/openunum.log` and `errors.log`. | ✅ Implemented |
| **Intervention Trace** | `agent.mjs` — `trace.intervention_trace[]` logs drift corrections, continuations, checklist enforcement, anchor injections. Exposed via `GET /api/sessions/:id/trace`. | ✅ Implemented |
| **Tool Execution Trace** | `agent.mjs` — `trace.iterations[]`, `trace.toolStateTransitions[]`, `trace.permissionDenials[]`. Execution envelope tracked. | ✅ Implemented |
| **Unified Audit Log** | ❌ No unified audit log — Logs are append-only JSON lines but not structured for audit reconstruction. No correlation IDs across tool calls. | ❌ Missing |
| **Tamper Evidence** | ❌ No tamper-evident logging — No hashing, signing, or append-only guarantees. Logs can be modified post-facto. | ❌ Missing |
| **Trace Reconstruction** | ⚠️ Partial — Intervention trace allows reconstructing what interventions fired, but full execution trace (tool inputs/outputs, state transitions) not persisted to durable storage. Session history in memory store. | ⚠️ Partial |

**Gap:** No tamper-evident audit log. No unified correlation ID for end-to-end trace reconstruction. Logs are best-effort append, not cryptographically secured.

---

### Gaps

| Priority | Gap | Risk | Recommendation |
|----------|-----|------|----------------|
| **P0** | No tamper-evident audit logging | High — Cannot prove what happened if system compromised | Add HMAC-signed append-only audit log with chain hashing |
| **P0** | No explicit ODD (Operational Design Domain) per mode | High — No clear boundaries for when agent should refuse to act | Define ODD per execution tier (compact/balanced/full) with explicit confidence thresholds |
| **P1** | No epistemic vs. aleatoric uncertainty separation | Medium — Cannot apply appropriate mitigation strategies | Add uncertainty type classification in confidence scorer |
| **P1** | No confidence-based action gating | Medium — Low-confidence actions can still mutate state | Require human approval for mutating tools when confidence < 0.3 |
| **P1** | No unified correlation ID for audit reconstruction | Medium — Difficult to reconstruct full execution trace | Add `traceId` propagated through all tool calls and logs |
| **P2** | Drift detection is keyword-based, not semantic | Low — May miss subtle drift or false-positive on keyword matches | Add semantic similarity check against anchor task |
| **P2** | No explicit read-only mode trigger | Low — No graceful degradation to observation-only mode | Add read-only fallback when confidence drops below threshold |

---

### Maturity Scores

| Dimension | Status | Evidence |
|-----------|--------|----------|
| **Operational Envelopes** | 🟡 Amber | Execution profiles exist (compact/balanced/full) but no explicit ODD with confidence thresholds per mode |
| **Validate-Before-Act Gates** | 🟢 Green | Pre-flight validator, policy engine, self-protection patterns all implemented and enforced |
| **Graceful Degradation** | 🟡 Amber | Auto-recovery and health monitoring exist, but no explicit read-only mode or confidence-based escalation |
| **World-Model Separation** | 🟡 Amber | Working memory anchor tracks expected state, drift detection exists but is keyword-based not quantitative |
| **Uncertainty Handling** | 🟡 Amber | Confidence scoring implemented but no epistemic/aleatoric separation, no confidence-based action gating |
| **Auditability** | 🔴 Red | Logging exists but no tamper evidence, no unified correlation IDs, no cryptographically secured audit trail |

---

### Recommendations

#### Immediate (P0)

1. **Add Tamper-Evident Audit Logging**
   - Create `src/core/audit-log.mjs` with HMAC-SHA256 chain hashing
   - Each entry includes: `timestamp`, `traceId`, `event`, `hash(prevHash + data)`
   - Store in append-only file with periodic Merkle root commits

2. **Define Explicit ODD per Execution Tier**
   - Extend `config.mjs.modelExecutionProfiles` with:
     ```javascript
     odd: {
       maxConfidenceRequired: 0.7,  // Minimum confidence for mutating actions
       allowedDomains: ['file_ops', 'shell_readonly'],  // Or 'full' for trusted tier
       requireHumanApproval: true   // For low-confidence actions
     }
     ```

#### Short-Term (P1)

3. **Add Uncertainty Type Classification**
   - Extend `confidence-scorer.mjs` to distinguish:
     - Epistemic: Model uncertainty (lack of knowledge) → Mitigate with more data/reasoning
     - Aleatoric: Environmental noise → Mitigate with redundancy/verification

4. **Implement Confidence-Based Action Gating**
   - In `execution-policy-engine.mjs`, add:
     ```javascript
     if (confidence < 0.3 && MUTATING_TOOLS.has(toolName)) {
       return { allow: false, reason: 'low_confidence_requires_approval' };
     }
     ```

5. **Add Unified Correlation ID**
   - Generate `traceId` at session start, propagate through all tool calls and logs
   - Enables end-to-end trace reconstruction from audit log

#### Medium-Term (P2)

6. **Semantic Drift Detection**
   - Replace keyword-based drift detection in `working-memory.mjs` with embedding similarity
   - Use memory embeddings to compute cosine similarity between current output and anchor task

7. **Explicit Read-Only Mode**
   - Add `readOnlyMode` flag in agent runtime
   - Trigger when confidence drops below 0.2 or consecutive failures exceed threshold
   - Only allow read tools (file_read, memory_recall, web_search, browser_snapshot)

---

### Overall Assessment

**Maturity Level:** 🟡 **Amber — Foundational safety mechanisms present, critical gaps in auditability and uncertainty handling**

OpenUnum has strong foundational safety mechanisms (proof scoring, pre-flight validation, self-protection policies, auto-recovery). However, it lacks critical AV/robotics safety patterns:

- **No tamper-evident audit trail** — Cannot prove what happened if system is compromised
- **No explicit ODD** — No clear boundaries for when agent should refuse to act
- **No uncertainty type separation** — Cannot apply appropriate mitigation strategies
- **No confidence-based action gating** — Low-confidence actions can still mutate state

**Recommendation:** Address P0 gaps before deploying in safety-critical contexts. P1/P2 improvements should be prioritized for production readiness.

---

*Report generated by Council Member 6 subagent for AV/Robotics Safety Evaluation.*
