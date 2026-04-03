# Next Tasks

Context: the planner-backed autonomy framework is now in place. The next tranche should tighten durability and promotion policy around the remaining autonomy surfaces.

## 1. Persist Workers And Self-Edit Runs

Goal:
- make worker runs and self-edit runs restart-safe the same way missions and generic tasks now persist

Why:
- generic tasks already survive restart
- worker and self-edit history still rely too heavily on in-memory state
- unattended autonomy needs durable operator-visible records

Deliverables:
- SQLite tables for worker runs and self-edit runs
- `list/status` APIs that survive restart
- interruption marking for in-flight runs after restart

## 2. Expand Planner Policies

Goal:
- add more deterministic planner policies so plain-language goals compile into short executable graphs across more intent classes

Priority intent classes:
- deploy
- benchmark
- sync
- diagnose
- cleanup

Why:
- the framework should not fall back to a generic mission-only shape for most goals
- smaller/local models benefit when the system pre-structures the execution path

Deliverables:
- intent classifier expansion in `src/core/goal-task-planner.mjs`
- bounded preflight steps per intent class
- regression coverage for each new planner policy

## 3. Add Promotion Policy Gates

Goal:
- require stronger validation before planner-generated self-edit tasks can be promoted

Why:
- self-edit now has validation/canary/rollback, but promotion policy is still too uniform
- path-specific guardrails are needed for unattended autonomy

Deliverables:
- path-class policies:
  - UI files
  - server/runtime files
  - docs-only changes
- required validations per path class
- explicit blocked-promotion reasons in run status/output

## Immediate Follow-Up

- investigate the session pattern where tools execute but the model does not emit a final natural-language answer
- consider a deterministic summarizer fallback for that exact failure mode so the user gets a usable answer instead of a raw action dump
