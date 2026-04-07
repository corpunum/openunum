# Phase 4 Plan — Remediation Roadmap

**Version:** 1.0.0  
**Date:** 2026-04-07  
**Status:** 🟡 Planned — Awaiting Implementation  
**Source:** Council Consolidated Report (2026-04-07)

---

## Executive Summary

Phase 4 implements the **top 10 council-voted recommendations** to address critical gaps identified in the Phase 1-3 architecture validation. Focus areas:

1. **Tamper-evident audit logging** (R1)
2. **Independent verifier component** (R3)
3. **Hippocampal replay / memory consolidation** (R2)
4. **Explicit ODD per execution tier** (R4)
5. **Freshness decay mechanisms** (R5)

**Timeline:** 6 weeks total (2 weeks Phase 1, 2 weeks Phase 2, 2 weeks Phase 3)  
**Priority:** P0/Critical — Required for safety-critical deployment

---

## Phase 4.1: Critical Foundation (Weeks 1-2)

### Week 1: Audit + ODD + Decay

#### R1: Tamper-Evident Audit Logging
**Priority:** P0/Critical | **Effort:** Medium | **Impact:** 10/10  
**Votes:** 6/6 council members

**Tasks:**
- [ ] Create `src/core/audit-log.mjs` with HMAC-SHA256 chain hashing
- [ ] Implement append-only log file format
- [ ] Add Merkle root computation on each state transition
- [ ] Create `/api/audit/log` endpoint for log retrieval
- [ ] Create `/api/audit/verify` endpoint for chain verification
- [ ] Add audit entries for: tool calls, state changes, config mutations

**Acceptance Criteria:**
```javascript
// Each audit entry includes:
{
  "entryId": "audit_001234",
  "timestamp": "2026-04-07T15:30:00Z",
  "eventType": "tool_call",
  "correlationId": "trace_abc123",
  "previousHash": "sha256_prev",
  "currentHash": "sha256_current",
  "payload": { /* event data */ }
}
```

**Files:**
- `src/core/audit-log.mjs` (new)
- `src/server/routes/audit.mjs` (new)
- `tests/e2e/audit-logging.e2e.mjs` (new)

---

#### R4: Explicit ODD per Execution Tier
**Priority:** P0/Critical | **Effort:** Small | **Impact:** 9/10  
**Votes:** 5/6 council members

**Tasks:**
- [ ] Extend `src/config.mjs` with ODD definitions per tier
- [ ] Add confidence thresholds for each execution mode
- [ ] Implement action gating based on confidence scores
- [ ] Add refusal logic for low-confidence mutating actions
- [ ] Document ODD boundaries in BRAIN.MD

**Acceptance Criteria:**
```javascript
// config.mjs additions
modelExecutionProfiles: {
  compact: {
    odd: {
      maxConfidenceRequired: 0.7,
      allowedTools: ['file_read', 'http_request', 'browser_snapshot'],
      blockedTools: ['file_write', 'shell_run', 'file_patch'],
      requireHumanApproval: true
    }
  },
  balanced: {
    odd: {
      maxConfidenceRequired: 0.5,
      allowedTools: ['file_read', 'file_write', 'http_request'],
      blockedTools: ['shell_run'],
      requireHumanApproval: false
    }
  },
  full: {
    odd: {
      maxConfidenceRequired: 0.3,
      allowedTools: 'all',
      blockedTools: [],
      requireHumanApproval: false
    }
  }
}
```

**Files:**
- `src/config.mjs` (edit)
- `src/core/execution-policy-engine.mjs` (edit)
- `docs/ODD_DEFINITIONS.md` (new)

---

#### R5: Freshness Decay Mechanisms
**Priority:** P1/High | **Effort:** Small | **Impact:** 8/10  
**Votes:** 5/6 council members

**Tasks:**
- [ ] Add `decayScore(timestamp, halfLifeDays)` to `src/memory/store.mjs`
- [ ] Update retrieval functions to weight by freshness
- [ ] Add `/api/memory/freshness` endpoint
- [ ] Add `/api/memory/stale` endpoint (items below threshold)
- [ ] Add `/api/memory/refresh` endpoint (manual refresh trigger)
- [ ] Set default half-life: 30 days for memories, 7 days for strategies

**Acceptance Criteria:**
```javascript
// Decay formula: freshness = 0.5^(ageInDays / halfLifeDays)
// Example: 30-day old memory with 30-day half-life → 0.5 freshness score

// API response example
GET /api/memory/stale
{
  "staleMemories": [
    { "id": "mem_123", "ageDays": 45, "freshness": 0.35 },
    { "id": "mem_456", "ageDays": 60, "freshness": 0.25 }
  ]
}
```

**Files:**
- `src/memory/store.mjs` (edit)
- `src/server/routes/memory.mjs` (edit)
- `tests/e2e/freshness-decay.e2e.mjs` (new)

---

### Week 2: Role-Model + Retry + Confidence Gating

#### R6: Role-to-Model Registry
**Priority:** P1/High | **Effort:** Small | **Impact:** 8/10  
**Votes:** 4/6 council members

**Tasks:**
- [ ] Create `src/core/role-model-registry.mjs`
- [ ] Define task types: `research`, `code_gen`, `code_review`, `file_ops`, `browser_automation`, `chat`
- [ ] Map each task type to allowed model tiers
- [ ] Add `/api/roles` endpoint for registry queries
- [ ] Integrate with task planner for automatic model selection

**Acceptance Criteria:**
```javascript
// role-model-registry.mjs
export const roleModelRegistry = {
  research: {
    minTier: 'balanced',
    recommended: ['ollama/qwen3.5:397b-cloud', 'nvidia/llama-3.3-nemotron-super-49b-v1'],
    blocked: ['ollama/qwen3.5:9b-64k'] // too weak for synthesis
  },
  code_gen: {
    minTier: 'full',
    recommended: ['openai-codex/gpt-5.4', 'ollama/qwen3.5:397b-cloud'],
    blocked: []
  },
  file_ops: {
    minTier: 'compact',
    recommended: ['ollama/qwen3.5:9b-64k'],
    blocked: []
  }
};
```

**Files:**
- `src/core/role-model-registry.mjs` (new)
- `src/core/goal-task-planner.mjs` (edit)
- `docs/ROLE_MODEL_MAPPING.md` (new)

---

#### R7: Transport-Layer Retry Policy
**Priority:** P1/High | **Effort:** Small | **Impact:** 8/10  
**Votes:** 4/6 council members

**Tasks:**
- [ ] Create `src/providers/retry-policy.mjs`
- [ ] Implement exponential backoff (200ms → 2s, max 2 retries)
- [ ] Add error classification (transient vs. permanent)
- [ ] Implement fast-fail on auth/quota errors
- [ ] Add provider health tracking with 5-min TTL backoff

**Acceptance Criteria:**
```javascript
// retry-policy.mjs
export class RetryPolicy {
  async execute(fn, options) {
    // Exponential backoff: 200ms, 400ms, 800ms, 1600ms, 3200ms
    // Max 2 retries for transient errors
    // Immediate fail on 401/403/429 (auth/quota)
  }
}

// Provider health tracking
GET /api/providers/health
{
  "providers": {
    "ollama": { "status": "healthy", "failures": 0 },
    "openrouter": { "status": "degraded", "failures": 3, "backoffUntil": "2026-04-07T15:35:00Z" }
  }
}
```

**Files:**
- `src/providers/retry-policy.mjs` (new)
- `src/providers/index.mjs` (edit)
- `src/server/routes/providers.mjs` (edit)

---

#### R10: Confidence-Based Action Gating
**Priority:** P1/High | **Effort:** Small | **Impact:** 7/10  
**Votes:** 4/6 council members

**Tasks:**
- [ ] Extend `src/core/confidence-scorer.mjs` with action gating
- [ ] Add confidence thresholds per tool category
- [ ] Block mutating tools when confidence < 0.3
- [ ] Add human approval workflow for low-confidence actions
- [ ] Log gated actions for later analysis

**Acceptance Criteria:**
```javascript
// Confidence gating logic
if (confidenceScore < 0.3 && tool.mutating === true) {
  // Block action, request human approval
  return {
    blocked: true,
    reason: 'Low confidence on mutating action',
    requiresApproval: true,
    approvalUrl: '/api/approvals/request'
  };
}
```

**Files:**
- `src/core/confidence-scorer.mjs` (edit)
- `src/core/execution-policy-engine.mjs` (edit)
- `src/server/routes/approvals.mjs` (new)

---

## Phase 4.2: Verification & Consolidation (Weeks 3-4)

### Week 3-4: Verifier + State Diffs + Replay

#### R3: Independent Verifier Component
**Priority:** P0/Critical | **Effort:** Large | **Impact:** 10/10  
**Votes:** 6/6 council members

**Tasks:**
- [ ] Create `src/core/verifier.mjs` as separate process
- [ ] Implement state validation independent from executor
- [ ] Add verification contracts for high-stakes operations
- [ ] Create `/api/verifier/check` endpoint
- [ ] Create `/api/verifier/stats` endpoint
- [ ] Integrate with self-edit pipeline for pre-promotion validation

**Acceptance Criteria:**
```javascript
// Verifier runs as separate process
const verifier = new IndependentVerifier({
  validateStateChanges: true,
  checkInvariants: true,
  verifyToolResults: true
});

// Verification result
{
  "verified": true,
  "checks": [
    { "name": "state_consistency", "passed": true },
    { "name": "tool_result_validity", "passed": true },
    { "name": "invariant_preservation", "passed": true }
  ],
  "confidence": 0.95
}
```

**Files:**
- `src/core/verifier.mjs` (new)
- `src/server/routes/verifier.mjs` (new)
- `tests/e2e/verifier.e2e.mjs` (new)

---

#### R8: State Diff Computation Layer
**Priority:** P1/High | **Effort:** Medium | **Impact:** 8/10  
**Votes:** 4/6 council members

**Tasks:**
- [ ] Create `src/core/state-diff.mjs`
- [ ] Compute structured diffs before applying state changes
- [ ] Add diff preview endpoint for review
- [ ] Implement rollback from diff snapshots
- [ ] Add diff persistence for audit trail

**Acceptance Criteria:**
```javascript
// State diff structure
{
  "diffId": "diff_001234",
  "timestamp": "2026-04-07T15:30:00Z",
  "changes": [
    {
      "table": "execution_state",
      "operation": "UPDATE",
      "before": { "status": "running" },
      "after": { "status": "completed" }
    },
    {
      "table": "memory_facts",
      "operation": "INSERT",
      "record": { /* new fact */ }
    }
  ],
  "merkleRoot": "sha256_root"
}
```

**Files:**
- `src/core/state-diff.mjs` (new)
- `src/memory/store.mjs` (edit)
- `src/server/routes/state.mjs` (new)

---

#### R2: Hippocampal Replay
**Priority:** P0/Critical | **Effort:** Large | **Impact:** 9/10  
**Votes:** 5/6 council members

**Tasks:**
- [ ] Create `src/core/memory-consolidator.mjs`
- [ ] Implement scheduled replay (24-hour cycle)
- [ ] Extract patterns from repeated successes/failures
- [ ] Add consolidation state tracking
- [ ] Implement retrieval boosts for consolidated memories
- [ ] Add loop prevention (don't re-consolidate same pattern)

**Acceptance Criteria:**
```javascript
// Consolidator runs on schedule
const consolidator = new MemoryConsolidator({
  replayIntervalHours: 24,
  minSuccessesForPattern: 3,
  minFailuresForPattern: 2
});

// Pattern extraction output
{
  "patternId": "pattern_001",
  "type": "success",
  "description": "Browser navigation succeeds after retry on timeout",
  "occurrences": 5,
  "heuristic": "Retry browser.navigate with 2s timeout on first failure"
}
```

**Files:**
- `src/core/memory-consolidator.mjs` (new)
- `src/memory/store.mjs` (edit)
- `tests/e2e/hippocampal-replay.e2e.mjs` (new)

---

## Phase 4.3: Advanced Hardening (Weeks 5-6)

### Week 5-6: Remaining Top-10 Recommendations

#### R11: Merkle Root Computation
**Priority:** P1/High | **Effort:** Medium | **Impact:** 8/10  
**Votes:** 4/6 council members

**Tasks:**
- [ ] Add `state_roots` table to SQLite schema
- [ ] Compute SHA-256 root over `execution_state` + `facts` tables
- [ ] Commit root on each state transition
- [ ] Add `/api/state/root` endpoint for light client queries
- [ ] Add `/api/proof/:id` endpoint for merkle proof verification

**Files:**
- `src/memory/store.mjs` (edit)
- `src/core/merkle-tree.mjs` (new)
- `src/server/routes/state.mjs` (edit)

---

#### R9: Sleep Cycles
**Priority:** P1/High | **Effort:** Medium | **Impact:** 7/10  
**Votes:** 3/6 council members

**Tasks:**
- [ ] Create `src/core/sleep-cycle.mjs`
- [ ] Trigger aggressive compaction after 1 hour idle
- [ ] Implement rest mode with reduced resource usage
- [ ] Add wake-on-event mechanism
- [ ] Log sleep/wake cycles for analysis

**Files:**
- `src/core/sleep-cycle.mjs` (new)
- `src/core/context-compact.mjs` (edit)

---

#### R12: Finality Gadget
**Priority:** P1/High | **Effort:** Medium | **Impact:** 7/10  
**Votes:** 3/6 council members

**Tasks:**
- [ ] Add `finalized` boolean to `execution_state` table
- [ ] Implement finality after N successful tool runs without reversal
- [ ] Add finality checkpoint endpoints
- [ ] Document finality semantics in API reference

**Files:**
- `src/memory/store.mjs` (edit)
- `src/core/finality.mjs` (new)

---

#### R13: Provider Health Tracking
**Priority:** P1/High | **Effort:** Small | **Impact:** 7/10  
**Votes:** 3/6 council members

**Tasks:**
- [ ] Track per-provider failures with TTL backoff
- [ ] Implement 5-min backoff after 3 consecutive failures
- [ ] Add health dashboard endpoint
- [ ] Auto-recover after backoff expires

**Files:**
- `src/providers/health-tracker.mjs` (new)
- `src/server/routes/providers.mjs` (edit)

---

#### R14: Canonical Tool-Call DTO
**Priority:** P1/High | **Effort:** Medium | **Impact:** 7/10  
**Votes:** 3/6 council members

**Tasks:**
- [ ] Define internal tool-call schema
- [ ] Create per-provider translators (Ollama, OpenAI, NVIDIA, etc.)
- [ ] Add streaming normalization
- [ ] Validate all tool calls against canonical schema

**Files:**
- `src/tools/canonical-dto.mjs` (new)
- `src/providers/*.mjs` (edit all providers)

---

## Testing Requirements

All Phase 4 implementations require:

1. **Unit tests** in `tests/unit/` for new modules
2. **E2E tests** in `tests/e2e/` for API endpoints
3. **Smoke tests** in `scripts/` for quick health checks
4. **Documentation updates** in `docs/` for new features

### New Test Files Required

| Test File | Covers |
|-----------|--------|
| `tests/e2e/audit-logging.e2e.mjs` | R1: Chain hashing, verification |
| `tests/e2e/freshness-decay.e2e.mjs` | R5: Decay scoring, stale detection |
| `tests/e2e/verifier.e2e.mjs` | R3: Independent validation |
| `tests/e2e/hippocampal-replay.e2e.mjs` | R2: Scheduled consolidation |
| `tests/e2e/odd-enforcement.e2e.mjs` | R4: ODD gating, confidence thresholds |

---

## Deployment Checklist

Before deploying Phase 4:

- [ ] All E2E tests pass (`npm run test:e2e`)
- [ ] All smoke tests pass (`npm run test:smoke`)
- [ ] Documentation updated (this file + API_REFERENCE.md)
- [ ] Changelog updated (`CHANGELOG_CURRENT.md`)
- [ ] Git commit created with descriptive message
- [ ] Backup created before deployment
- [ ] Rollback plan documented

---

## Success Metrics

Phase 4 is complete when:

1. ✅ **Audit logging** — All state changes logged with HMAC chain
2. ✅ **Independent verifier** — Separate process validates high-stakes ops
3. ✅ **Memory consolidation** — 24-hour replay cycle running
4. ✅ **ODD enforcement** — Confidence gating active per tier
5. ✅ **Freshness decay** — 30-day half-life applied to all memories
6. ✅ **Role-model mapping** — Task types mapped to allowed models
7. ✅ **Retry policy** — Exponential backoff on all provider calls
8. ✅ **Confidence gating** — Low-confidence mutating actions blocked

---

## References

- `docs/COUNCIL_CONSOLIDATED_2026_04_07.md` — Source recommendations
- `docs/COUNCIL_ARCHITECTURE.md` — Council framework documentation
- `docs/API_REFERENCE.md` — API endpoint documentation
- `docs/TESTING.md` — Testing requirements and patterns

---

**Maintainer:** OpenUnum Team  
**Next Review:** 2026-04-21 (post-Phase 4 validation)
