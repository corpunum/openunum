# Docs Index

This folder is optimized for fast machine onboarding (fresh agent session, no prior memory).

## Reading Order

**First-time onboarding:**
1. [AGENT_ONBOARDING.md](AGENT_ONBOARDING.md) — Start here
2. [BRAIN.MD](../BRAIN.MD) — Core Operating Principles (9 principles)
3. [COUNCIL_ARCHITECTURE.md](COUNCIL_ARCHITECTURE.md) — 6-member council validation framework
4. [PHASES_MASTER_PLAN_2026-04-08.md](PHASES_MASTER_PLAN_2026-04-08.md) — Canonical phases execution record
5. [CODEBASE_MAP.md](CODEBASE_MAP.md) — File/folder structure
6. [API_REFERENCE.md](API_REFERENCE.md) — All API endpoints
7. [TESTING.md](TESTING.md) — Test suites and how to run them
8. [KERNEL_OVERLAY_CAPABILITY_MATRIX.md](KERNEL_OVERLAY_CAPABILITY_MATRIX.md)
9. [AUTONOMY_PACKS.md](AUTONOMY_PACKS.md)
10. [AUTONOMY_AND_MEMORY.md](AUTONOMY_AND_MEMORY.md)
11. [UI_BEHAVIOR.md](UI_BEHAVIOR.md)
12. [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) — How to run/maintain
13. [CONFIG_SCHEMA.md](CONFIG_SCHEMA.md)
14. [ULTIMATE_AUTONOMY_MODEL.md](ULTIMATE_AUTONOMY_MODEL.md)
15. [SKILLS_EMAIL_RESEARCH.md](SKILLS_EMAIL_RESEARCH.md)
16. [CONTEXT_COMPACTION.md](CONTEXT_COMPACTION.md)
17. [PROJECT_STATE_SNAPSHOT.md](PROJECT_STATE_SNAPSHOT.md) — Current state + Council results
18. [SERVER_REFACTOR_BLUEPRINT.md](SERVER_REFACTOR_BLUEPRINT.md)
19. [CHANGELOG_CURRENT.md](CHANGELOG_CURRENT.md) — Recent changes
20. [MODEL_AWARE_CONTROLLER.md](MODEL_AWARE_CONTROLLER.md)
21. [COMPETITIVE_ANALYSIS_CLAW_CODE.md](COMPETITIVE_ANALYSIS_CLAW_CODE.md)
22. [COMPETITIVE_ANALYSIS_OPENAI_CODEX.md](COMPETITIVE_ANALYSIS_OPENAI_CODEX.md)
23. [COMPETITIVE_ANALYSIS_GEMINI_CLI.md](COMPETITIVE_ANALYSIS_GEMINI_CLI.md)
24. [COMPETITIVE_ANALYSIS_MIMOUNUM.md](COMPETITIVE_ANALYSIS_MIMOUNUM.md)
25. [OPENUNUM_MULTI_MODEL_CONTROLLER_ACTION_PLAN.md](OPENUNUM_MULTI_MODEL_CONTROLLER_ACTION_PLAN.md)
26. [HF_DATASET_PIPELINE.md](HF_DATASET_PIPELINE.md)
27. [SELF_MONITORING.md](SELF_MONITORING.md)
28. [IMPROVEMENT_SUMMARY.md](IMPROVEMENT_SUMMARY.md)
29. [../NEXT_TASKS.md](../NEXT_TASKS.md)
30. [PHASE0_EXECUTION_PLAN.md](PHASE0_EXECUTION_PLAN.md) — Runtime contract/parity execution status
31. [REPO_HARVEST_CONSOLIDATED_PLAN_2026-04-08.md](REPO_HARVEST_CONSOLIDATED_PLAN_2026-04-08.md) — Consolidated external pattern harvest mapped to OpenUnum
32. [SESSION_IMITATION_REVIEW_2026-04-08.md](SESSION_IMITATION_REVIEW_2026-04-08.md) — Chat-session pattern review + imitation test outcomes
33. [SELF_READING_INDEX.md](SELF_READING_INDEX.md) — Curated machine-readable self-reading file map
34. [OPENUNUM_AUDIT_STATUS_2026-04-08.md](OPENUNUM_AUDIT_STATUS_2026-04-08.md) — Verified consolidated audit checklist + cleanup/test phased plan
35. [PHASES_MASTER_PLAN_2026-04-08.md](PHASES_MASTER_PLAN_2026-04-08.md) — Canonical remaining phases plan and execution status
36. [PHASES_COMPLETION_REPORT_2026-04-08.md](PHASES_COMPLETION_REPORT_2026-04-08.md) — Final closure evidence for all post-audit phases
37. [CURRENT_STATE_MATRIX.md](CURRENT_STATE_MATRIX.md) — Code/tests/docs/CI trust checkpoint

## Legacy Planning Docs

These files describe original planning context and early phase structure:
- [MASTER_PLAN.md](MASTER_PLAN.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [IMPLEMENTATION_SEQUENCE.md](IMPLEMENTATION_SEQUENCE.md)
- [E2E_GATES.md](E2E_GATES.md)
- [archive/README.md](archive/README.md)

## Single-File Orientation

If an agent can only read one doc first, read:
- [AGENT_ONBOARDING.md](AGENT_ONBOARDING.md)

## Current Focus

The current autonomy surface is centered on:
- planner-backed generic tasks (`/api/autonomy/tasks/plan`, `/api/autonomy/tasks/run`)
- bounded workers, self-edit, and model-scout workflows
- restart-safe task persistence in SQLite
- planner-backed chat `/auto` execution instead of a hardcoded mission shortcut
- runtime diagnostics contracts for operations (`/api/runtime/state-contract`, `/api/runtime/config-parity`)
