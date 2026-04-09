# Competitive Analysis — MimoUnum

Date: 2026-04-03
Scope: `/home/corp-unum/mimounum` and live WebUI at `http://127.0.0.1:30140`

## Executive Summary

MimoUnum is a compact and readable autonomous-agent runtime with a strong built-in training-data pipeline UX.
OpenUnum remains substantially stronger for production autonomy, mission/task orchestration, and recovery robustness.

Recommended strategy: harvest selected ideas (especially training pipeline surfaces and compact operator UX), not architecture replacement.

## What MimoUnum Does Better

1. Training pipeline as first-class runtime surface:
- endpoints for collect/export/report/cycle/import in one coherent module
- low-friction path from conversations to train/eval artifacts

2. Simplicity:
- much smaller codebase and dependency footprint
- easier for new contributors to reason about end-to-end behavior

3. Operator clarity:
- concise right-panel telemetry in WebUI (`health`, `config`, `autonomy`) with low cognitive load

## Where OpenUnum Is Stronger

1. Autonomy architecture:
- planner-backed task framework, richer mission lifecycle, stronger recovery synthesis

2. Provider/runtime governance:
- deeper fallback handling, capability routing, and policy surfaces

3. WebUI state durability:
- stronger pending/rehydration and execution-trace continuity in long-running turns

## MimoUnum Risks/Weaknesses

1. Secret wiring inconsistency:
- `/secrets` updates secret store, but providers consume keys from config model fields
- risk of false auth-state assumptions and accidental desync

2. Security hardening gaps:
- permissive CORS (`*`), no endpoint auth/rate limiting
- `execSync` usage in shell runtime and health checks

3. Mission scalability:
- single active mission model (`activeMission`) rather than persistent mission registry

4. Test reliability issues observed:
- fixed test port collisions
- one shell safety test failure in full suite run

## Harvest Plan For OpenUnum

1. Keep OpenUnum core orchestration as-is.
2. Add Mimo-style `training/*` API family backed by OpenUnum memory + HF pipeline artifacts.
3. Add a compact "Autonomy Scorecard" UI panel:
- aggregate success/failure/tool-quality signals
- link to export/report endpoints
4. Add deterministic dataset-quality scoring policy:
- reuse existing HF pilot schema
- expose score factors in API responses for transparency
5. Keep secret handling in OpenUnum secure surfaces only:
- do not mirror Mimo key/config coupling.

## Recommended Implementation Order

1. `training/report` and `training/collect` in OpenUnum.
2. `training/export` and `training/export/file` with format selection.
3. WebUI scorecard panel + quick-export actions.
4. `training/cycle` orchestration endpoint.
5. E2E coverage for all `training/*` routes and scorecard rendering.

