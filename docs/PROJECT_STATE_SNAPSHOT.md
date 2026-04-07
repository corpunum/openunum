# Project State Snapshot

Snapshot date: 2026-04-07  
**Phase:** Phase 1-3 Complete ✅ | Phase 4 Planned 🟡

## What Works End-to-End

- Web UI chat with in-flight animation, expandable execution traces, and Gemini-style visual shell
- Provider/model selection and ranked model catalog loading
- Strict provider locking and autonomy mode presets
- Tool execution with retry/backoff via executor daemon
- Browser CDP control + launch checks
- Telegram channel polling and send loop
- Mission runner with proof-based done criteria + retries + hard caps
- Memory persistence and strategy outcome reuse
- Session-safe pending chat handling during cross-session switching
- Modularized server route/service layer (`src/server/routes`, `src/server/services`)
- **Council validation framework** — 6 domain experts, 35 dimensions assessed
- **Working memory anchor** — Drift detection, subplan tracking, persistence
- **Context compaction** — Enriched artifact extraction, layered injection
- **Model behavior registry** — 9 behavior classes, 50-sample cap, 349 route lessons
- **Execution envelopes** — Tier-based tool allowlisting (compact/balanced/full)
- **Pre-flight validation** — Policy engine, self-protection patterns
- **Planner-backed tasks** — Generic goal compilation to bounded task graphs
- **Self-edit pipeline** — Validation/canary/rollback with path-aware promotion
- **Model scout workflow** — HF catalog discovery, local evaluation
- **Worker orchestration** — Bounded background tasks with allowlists
- **Pending rehydration** — Live trace state persistence across refreshes

## Phase 1-3 Completion Status

| System | Status | Test Coverage | Notes |
|--------|--------|---------------|-------|
| Working Memory Anchor | ✅ Complete | E2E tested | Drift detection, subplan tracking |
| Context Compaction | ✅ Complete | E2E tested | Enriched artifacts, layered injection |
| Model Behavior Registry | ✅ Complete | E2E tested | 349 route lessons recorded |
| Execution Envelopes | ✅ Complete | E2E tested | 3 tiers with tool allowlists |
| Pre-flight Validation | ✅ Complete | E2E tested | Policy engine, self-protection |
| Proof Scorer | ✅ Complete | E2E tested | Multi-factor completion validation |
| Council Framework | ✅ Complete | Validated | 6 councils, 35 dimensions |
| Planner-Backed Tasks | ✅ Complete | E2E tested | Generic goal compilation |
| Self-Edit Pipeline | ✅ Complete | E2E tested | Path-aware promotion gates |
| Model Scout | ✅ Complete | E2E tested | HF discovery + local eval |
| Worker Orchestrator | ✅ Complete | E2E tested | Bounded background tasks |
| Pending Rehydration | ✅ Complete | Browser tested | Live trace persistence |
| Turn Recovery | ✅ Complete | E2E tested | Evidence-based summaries |
| Research Shaping | ✅ Complete | E2E tested | Comparison answers, weak-answer replacement |

## Test Coverage Stats

| Suite | Tests | Coverage | Status |
|-------|-------|----------|--------|
| Unit Tests | 45+ | Core modules | ✅ Passing |
| E2E Tests | 37 phases | Full workflows | ✅ Passing |
| Smoke Tests | 8 scripts | API health | ✅ Passing |
| Browser Tests | 3 suites | WebUI interactions | ✅ Passing |

**Key E2E Test Files:**
- `tests/e2e/freshness-decay.e2e.mjs` — Memory half-life, staleness detection
- `tests/e2e/hippocampal-replay.e2e.mjs` — Replay triggers, consolidation states
- `tests/e2e/verifier.e2e.mjs` — Verification contracts, quality scoring
- `tests/e2e/audit-logging.e2e.mjs` — Chain integrity, tamper detection
- `tests/e2e/odd-enforcement.e2e.mjs` — ODD definitions, mode enforcement
- `tests/phase35.tool-call-markup-recovery.e2e.mjs` — Final-answer reliability
- `tests/phase32.pending-refresh-rehydrate.e2e.mjs` — Pending rehydration
- `tests/phase33.chat-scroll.e2e.mjs` — Chat stream scrolling
- `tests/phase27.worker-persistence.e2e.mjs` — Worker durability
- `tests/phase28.self-edit-promotion-policy.e2e.mjs` — Self-edit gates
- `tests/phase29.turn-recovery-summary.e2e.mjs` — Bounded recovery summaries
- `tests/phase30.research-answer-shaping.e2e.mjs` — Answer shaping

## Council Validation Results (2026-04-07)

**Overall Maturity:** 🟡 **Amber** (60% of ideal patterns)

| Status | Count | Percentage |
|--------|-------|------------|
| 🟢 Green | 8 | 23% |
| 🟡 Amber | 22 | 63% |
| 🔴 Red | 5 | 14% |

**Green Dimensions (Strengths):**
- Working memory anchor system
- Context compaction with artifacts
- Execution lanes (6 types)
- Model behavior registry
- Route lessons (349 recorded)
- ODD & execution envelopes
- Validate-before-act gates
- Head pointer (ordering)

**Red Dimensions (Critical Gaps):**
- Finality (no explicit finality gadget)
- Trust economics (no penalties/reputation)
- Independent verifier (agent scores own work)
- State diffs (no structured diff computation)
- Proof-of-validity (heuristic ≠ cryptographic)
- Freshness & decay (timestamps unused)
- Role-to-model mapping (no explicit registry)
- Auditability (no tamper evidence)

See `docs/COUNCIL_CONSOLIDATED_2026_04_07.md` for full report.

## Known Issues/Gaps from Council Report

| Issue | Priority | Phase 4 Remediation |
|-------|----------|---------------------|
| No tamper-evident audit logging | P0/Critical | R1: HMAC-SHA256 chain hashing |
| No independent verifier | P0/Critical | R3: Separate verifier process |
| No hippocampal replay | P0/Critical | R2: Scheduled consolidation |
| No explicit ODD per tier | P0/Critical | R4: Confidence thresholds |
| No freshness decay | P1/High | R5: 30-day half-life |
| No role-to-model registry | P1/High | R6: Task-type mappings |
| No transport retry policy | P1/High | R7: Exponential backoff |
| No state diff computation | P1/High | R8: Structured diffs |
| No Merkle root commitments | P1/High | R11: SHA-256 state roots |

See `docs/PHASE4_PLAN.md` for detailed remediation timeline.

## Remediation Timeline (Phase 4)

| Week | Focus | Deliverables |
|------|-------|--------------|
| Week 1 | Audit + ODD + Decay | R1, R4, R5 implemented |
| Week 2 | Role-Model + Retry + Gating | R6, R7, R10 implemented |
| Week 3-4 | Verifier + Diffs + Replay | R3, R8, R2 implemented |
| Week 5-6 | Advanced Hardening | R11, R9, R12, R13, R14 |

**Phase 4 Start:** 2026-04-08 (planned)  
**Phase 4 Complete:** 2026-05-20 (estimated)

## Minimum Commands for New Agent Session

```bash
cd /home/corp-unum/openunum
pnpm install
pnpm e2e
pnpm smoke:ui:noauth
node src/server.mjs
curl -sS http://127.0.0.1:18880/api/health
curl -sS http://127.0.0.1:18880/api/config
```

## Recommended First Runtime Action

Set autonomy mode based on task criticality:

```bash
curl -sS -X POST http://127.0.0.1:18880/api/autonomy/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"relentless"}'
```

## Documentation Status

| Document | Status | Last Updated |
|----------|--------|--------------|
| AGENT_ONBOARDING.md | ✅ Updated | 2026-04-07 |
| BRAIN.MD | ✅ Updated | 2026-04-07 |
| CODEBASE_MAP.md | ✅ Updated | 2026-04-07 |
| API_REFERENCE.md | ✅ Updated | 2026-04-07 |
| COUNCIL_ARCHITECTURE.md | ✅ NEW | 2026-04-07 |
| PHASE4_PLAN.md | ✅ NEW | 2026-04-07 |
| TESTING.md | ✅ Verified | 2026-04-07 |
| OPERATIONS_RUNBOOK.md | 🟡 Pending | 2026-04-03 |
| CHANGELOG_CURRENT.md | 🟡 Pending | 2026-04-03 |
| README.md | 🟡 Pending | 2026-04-03 |
