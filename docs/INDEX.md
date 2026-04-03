# Docs Index

This folder is optimized for fast machine onboarding (fresh agent session, no prior memory).

## Reading Order

1. [AGENT_ONBOARDING.md](/home/corp-unum/openunum/docs/AGENT_ONBOARDING.md)
2. [CODEBASE_MAP.md](/home/corp-unum/openunum/docs/CODEBASE_MAP.md)
3. [API_REFERENCE.md](/home/corp-unum/openunum/docs/API_REFERENCE.md)
4. [KERNEL_OVERLAY_CAPABILITY_MATRIX.md](/home/corp-unum/openunum/docs/KERNEL_OVERLAY_CAPABILITY_MATRIX.md)
5. [AUTONOMY_PACKS.md](/home/corp-unum/openunum/docs/AUTONOMY_PACKS.md)
6. [AUTONOMY_AND_MEMORY.md](/home/corp-unum/openunum/docs/AUTONOMY_AND_MEMORY.md)
7. [UI_BEHAVIOR.md](/home/corp-unum/openunum/docs/UI_BEHAVIOR.md)
8. [OPERATIONS_RUNBOOK.md](/home/corp-unum/openunum/docs/OPERATIONS_RUNBOOK.md)
9. [CONFIG_SCHEMA.md](/home/corp-unum/openunum/docs/CONFIG_SCHEMA.md)
10. [ULTIMATE_AUTONOMY_MODEL.md](/home/corp-unum/openunum/docs/ULTIMATE_AUTONOMY_MODEL.md)
11. [SKILLS_EMAIL_RESEARCH.md](/home/corp-unum/openunum/docs/SKILLS_EMAIL_RESEARCH.md)
12. [CONTEXT_COMPACTION.md](/home/corp-unum/openunum/docs/CONTEXT_COMPACTION.md)
13. [PROJECT_STATE_SNAPSHOT.md](/home/corp-unum/openunum/docs/PROJECT_STATE_SNAPSHOT.md)
14. [SERVER_REFACTOR_BLUEPRINT.md](/home/corp-unum/openunum/docs/SERVER_REFACTOR_BLUEPRINT.md)
15. [CHANGELOG_CURRENT.md](/home/corp-unum/openunum/docs/CHANGELOG_CURRENT.md)
16. [MODEL_AWARE_CONTROLLER.md](/home/corp-unum/openunum/docs/MODEL_AWARE_CONTROLLER.md)
17. [COMPETITIVE_ANALYSIS_CLAW_CODE.md](/home/corp-unum/openunum/docs/COMPETITIVE_ANALYSIS_CLAW_CODE.md)
18. [COMPETITIVE_ANALYSIS_OPENAI_CODEX.md](/home/corp-unum/openunum/docs/COMPETITIVE_ANALYSIS_OPENAI_CODEX.md)
19. [COMPETITIVE_ANALYSIS_GEMINI_CLI.md](/home/corp-unum/openunum/docs/COMPETITIVE_ANALYSIS_GEMINI_CLI.md)
20. [COMPETITIVE_ANALYSIS_MIMOUNUM.md](/home/corp-unum/openunum/docs/COMPETITIVE_ANALYSIS_MIMOUNUM.md)
21. [OPENUNUM_MULTI_MODEL_CONTROLLER_ACTION_PLAN.md](/home/corp-unum/openunum/docs/OPENUNUM_MULTI_MODEL_CONTROLLER_ACTION_PLAN.md)
22. [HF_DATASET_PIPELINE.md](/home/corp-unum/openunum/docs/HF_DATASET_PIPELINE.md)
23. [SELF_MONITORING.md](/home/corp-unum/openunum/docs/SELF_MONITORING.md)
24. [IMPROVEMENT_SUMMARY.md](/home/corp-unum/openunum/docs/IMPROVEMENT_SUMMARY.md)
25. [../NEXT_TASKS.md](/home/corp-unum/openunum/NEXT_TASKS.md)

## Legacy Planning Docs

These files describe original planning context and early phase structure:
- [MASTER_PLAN.md](/home/corp-unum/openunum/docs/MASTER_PLAN.md)
- [ARCHITECTURE.md](/home/corp-unum/openunum/docs/ARCHITECTURE.md)
- [IMPLEMENTATION_SEQUENCE.md](/home/corp-unum/openunum/docs/IMPLEMENTATION_SEQUENCE.md)
- [E2E_GATES.md](/home/corp-unum/openunum/docs/E2E_GATES.md)

## Single-File Orientation

If an agent can only read one doc first, read:
- [AGENT_ONBOARDING.md](/home/corp-unum/openunum/docs/AGENT_ONBOARDING.md)

## Current Focus

The current autonomy surface is centered on:
- planner-backed generic tasks (`/api/autonomy/tasks/plan`, `/api/autonomy/tasks/run`)
- bounded workers, self-edit, and model-scout workflows
- restart-safe task persistence in SQLite
- planner-backed chat `/auto` execution instead of a hardcoded mission shortcut
