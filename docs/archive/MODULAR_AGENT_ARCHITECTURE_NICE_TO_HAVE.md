# Modular Agent Architecture (Nice To Have, Not Implemented)

Date: 2026-04-03
Status: Design-only backlog for OpenUnum

## Goal

Define a default orchestration architecture that scales from weak models (serial specialist routing) to strong models (parallel specialist routing) without changing user workflow.

## Core Roles

1. `orchestrator`
- Owns goal decomposition, risk policy, budget, and final synthesis.

2. `research`
- External retrieval, source filtering, citation/provenance assembly.

3. `backend`
- API/runtime/system changes and verification.

4. `frontend`
- UI/UX and client-side behavior changes and verification.

5. `qa-e2e`
- End-to-end flows, regression checks, scenario validation.

6. `qa-smoke`
- Fast health gates and preflight checks.

7. `ops-runtime`
- Service/process/environment checks and recovery suggestions.

8. `vision-ocr` (optional)
- Screenshot/image interpretation and OCR extraction.

## Memory Model

1. `global mission memory`
- Shared objective state, constraints, proof artifacts, acceptance criteria.

2. `role-local memory`
- Specialist heuristics and recent context for each role.

3. `handoff contracts`
- Structured payloads between roles:
  - `intent`
  - `inputs`
  - `actions`
  - `evidence`
  - `status`
  - `next-needed`

## Scheduling Policy

1. Weak-model mode (`compact`)
- Serial specialist execution.
- Narrow tool allowlists.
- Hard iteration caps.

2. Mid-model mode (`balanced`)
- Limited parallelism (`2` specialists max).
- Strict merge gates in orchestrator.

3. Strong-model mode (`full`)
- Parallel specialist fan-out with bounded concurrency.
- Orchestrator arbitration + proof reconciliation.

## Safety/Control Gates

1. Specialist tool scopes are role-bounded.
2. Mutating actions require explicit proof from prior check steps.
3. Final response requires merged evidence contract.
4. Escalation path when specialist confidence is low.

## Rollout Plan (Future)

1. Phase A: Role contracts + internal role registry.
2. Phase B: Serial specialist execution for compact mode.
3. Phase C: Bounded parallel specialist execution for full mode.
4. Phase D: Role-local memory + global memory merge policies.
5. Phase E: Per-role evaluation dashboards and regression suites.

## Success Metrics

1. Mission completion rate.
2. Proof-backed completion rate.
3. Recovery success after partial failures.
4. Latency/cost per completed mission by execution envelope.
5. Quality delta between monolithic vs modular routing.
