## StarkNet-Inspired Architecture Evaluation

### Current Validation Gates

OpenUnum implements several validation mechanisms, though they differ significantly from StarkNet's validate-before-execute paradigm:

**1. Pre-Flight Validation (`src/core/preflight-validator.mjs`)**
- Validates tool arguments before execution (required fields, types, URL validity)
- Covers ~20 tool types: `file_read`, `file_write`, `shell_run`, `browser_*`, `email_*`, etc.
- Returns `{ valid: boolean, hint?: string }` for error messaging
- **Limitation**: Runs inline during tool call, not as a separate validation transaction

**2. Tool Validator (`src/core/tool-validator.mjs`)**
- Pre-execution: Checks required arguments, types, dangerous patterns (rm -rf, sudo, etc.)
- Post-execution: Validates results aren't empty/error states
- Auto-correction for common mistakes (missing optional args, type coercion)
- Tracks validation stats (totalValidated, preExecutionFailures, postExecutionFailures, autoCorrected)
- **Limitation**: Same component handles both validation and coordinates execution

**3. Model Execution Envelope (`src/core/model-execution-envelope.mjs`)**
- Tier-based tool allowlists (compact/balanced/full) based on model size
- Very small models (≤8B) get restricted tool sets
- `toolAllowlist` enforced at agent turn level
- **Nature**: This is a guardrail/constraint, not validation

**4. Proof Scorer (`src/core/proof-scorer.mjs`)**
- Multi-factor scoring (0-1) for completion claims:
  - Tool success ratio (0.25 weight)
  - Output substance (0.20 weight)
  - Goal alignment (0.20 weight)
  - Error absence (0.15 weight)
  - Verification depth (0.10 weight) — detects verification language
  - Claim specificity (0.10 weight) — detects concrete evidence markers
- Threshold: 0.6 for "done" confidence
- **Key insight**: Scores *claim quality*, doesn't independently verify state

**5. Execution Contract (`src/core/execution-contract.mjs`)**
- `isProofBackedDone()` checks if "done" claims have tool evidence
- `shouldForceContinuation()` prevents premature termination
- Uses proof-scorer to validate completion claims

### Separation Assessment

**Current State: Partially Separated**

| Component | Role | Separation Level |
|-----------|------|------------------|
| `preflight-validator.mjs` | Pre-execution arg validation | ✅ Separate module |
| `tool-validator.mjs` | Pre/post execution validation | ⚠️ Integrated with execution flow |
| `proof-scorer.mjs` | Post-execution claim scoring | ✅ Separate module |
| `model-execution-envelope.mjs` | Tool allowlists | ✅ Separate module |
| Agent loop (`agent.mjs`) | Orchestrates all of the above | ❌ Single point of control |

**Critical Gap**: The agent itself orchestrates validation → execution → scoring. There is no *independent verifier* that runs separately from the executor. In StarkNet terms, the sequencer (executor) and verifier are distinct; here they're the same process.

**What Exists (Guardrails)**:
- Tool allowlists per model tier
- Dangerous pattern detection
- Argument schema validation
- Post-execution result sanity checks

**What's Missing (True Verification)**:
- Independent verification transaction
- State diff computation before application
- Cryptographic or structural validity proofs
- Separate verifier that doesn't trust the executor

### Gaps

**1. No Validate-Before-Execute Transaction Separation**
- Validation happens inline within the agent's execution loop
- No separate "validation transaction" that must succeed before execution is permitted
- Validator and executor share the same trust boundary

**2. No Independent Verifier Component**
- `proof-scorer.mjs` scores claims but runs within the same agent process
- No separate process/service that independently verifies state changes
- The agent scores its own work (conflict of interest from a security perspective)

**3. No State Diff Computation**
- State changes are applied directly via tool execution
- No intermediate "state diff" representation that could be reviewed/verified
- No mechanism to say "here's what *would* change" before applying it

**4. No Proof-of-Validity Generation**
- `proof-scorer.mjs` generates a *confidence score*, not a validity proof
- No cryptographic attestation or structural proof that execution was valid
- Evidence is heuristic (keyword matching, output length) not cryptographic

**5. Guardrails Conflated with Verification**
- Tool allowlists are *constraints*, not verification
- Dangerous pattern detection is *prevention*, not verification
- These reduce attack surface but don't prove correctness

**6. No Verifier-Executor Mismatch Detection**
- StarkNet can detect when a sequencer submits invalid state transitions
- OpenUnum has no mechanism to detect if the agent "lied" about what it did
- Trust is placed in the agent process itself

### Maturity Scores

| Dimension | Status | Evidence |
|-----------|--------|----------|
| Validate-Before-Act | 🟡 Amber | Pre-flight validation exists but runs inline, not as separate transaction |
| Independent Verifier | 🔴 Red | No separate verifier; agent scores its own work via proof-scorer |
| State Diffs | 🔴 Red | No state diff computation; changes applied directly |
| Proof-of-Validity | 🔴 Red | Confidence scoring ≠ validity proofs; heuristic not cryptographic |
| Guardrails vs. Verification | 🟡 Amber | Guardrails well-implemented (allowlists, patterns); verification is claim-scoring not state verification |

### Recommendations

**Priority 1: Introduce Verification Separation (High)**

```javascript
// New: src/core/verifier.mjs
export class StateVerifier {
  // Independent verification of proposed state changes
  async verifyStateDiff(proposedDiff, currentState) {
    // 1. Validate diff structure
    // 2. Check diff doesn't violate constraints
    // 3. Return { valid: bool, reasons: [] }
  }
  
  // Verify execution matched the proposal
  async verifyExecutionResult(proposedDiff, actualResult) {
    // Compare what was proposed vs what happened
    // Detect executor lies or errors
  }
}
```

**Priority 2: Add State Diff Layer (High)**

```javascript
// New: src/core/state-diff.mjs
export function computeStateDiff(beforeState, afterState) {
  // Return structured diff: { added: [], modified: [], deleted: [] }
  // This diff can be reviewed before application
}

export function applyStateDiff(currentState, diff) {
  // Apply diff atomically
  // Return { success: bool, newState: object, rollback: fn }
}
```

**Priority 3: Enhance Proof Scorer to Validity Checker (Medium)**

Transform `proof-scorer.mjs` from heuristic scoring to structural validation:

```javascript
// Enhance existing proof-scorer.mjs
export function generateValidityProof({ toolCalls, toolResults, expectedState }) {
  return {
    proofHash: crypto.createHash('sha256').update(JSON.stringify({ toolCalls, toolResults })).digest('hex'),
    merkleRoot: buildMerkleRoot(toolResults), // If multiple operations
    stateRootBefore: expectedState.hash,
    stateRootAfter: computeStateHash(toolResults),
    timestamp: Date.now()
  };
}
```

**Priority 4: Separate Verifier Process (Medium)**

For high-stakes operations, spawn a separate verification process:

```javascript
// In agent.mjs, for sensitive operations:
const verifier = spawnVerifier({ /* config */ });
const validationResult = await verifier.validate({ toolCalls, proposedDiff });
if (!validationResult.valid) {
  throw new Error('Independent verification failed');
}
// Only then execute
```

**Priority 5: Add Verification Gates to Execution Envelope (Low)**

```javascript
// Enhance model-execution-envelope.mjs
export function resolveExecutionEnvelope({ provider, model, runtime }) {
  // ... existing logic ...
  return {
    // ... existing fields ...
    requiresIndependentVerification: tier === 'compact' && involvesStateChange,
    verificationTimeout: 5000, // ms to wait for verifier
    rollbackOnVerificationFailure: true
  };
}
```

**Priority 6: Implement Verification Logging/Auditing (Low)**

```javascript
// New: src/core/verification-log.mjs
export function logVerificationEvent({ eventType, executor, verifier, result, proof }) {
  // Append to append-only log
  // Enables post-hoc audit of all state changes
}
```

---

## Summary

OpenUnum has **good guardrails** (tool allowlists, dangerous pattern detection, argument validation) but **weak verification** (no independent verifier, no state diffs, no validity proofs). The architecture is closer to "trust but validate arguments" than StarkNet's "verify before you trust."

**Key architectural shift needed**: Separate the *executor* (agent making changes) from the *verifier* (component proving changes are valid). Currently they're the same process, which means a compromised or buggy agent can bypass all validation.

**StarkNet alignment score**: ~30%
- ✅ Has pre-execution validation (different implementation)
- ✅ Has post-execution scoring (different purpose)
- ❌ No independent verifier
- ❌ No state diffs
- ❌ No validity proofs
- ❌ No separation of concerns between execution and verification
