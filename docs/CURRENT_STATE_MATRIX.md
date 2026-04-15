# Current State Matrix (2026-04-13)

This is the quick trust checkpoint for code, runtime, tests, docs, and remaining debt.

| Surface | Canonical Source | Status |
|---|---|---|
| Runtime server/API behavior | `src/server.mjs` + `src/server/routes/*` | Active |
| Runtime route inventory | `docs/ROUTE_REGISTRY.json` | Generated + freshness-gated |
| Web UI behavior | `src/ui/index.html`, `src/ui/styles.css`, `src/ui/app.js`, `src/ui/modules/*` | Active |
| Pending chat delivery | `/api/chat`, `/api/chat/stream`, `/api/chat/pending` | Active, turn-aware |
| Pending queue watchdog | `/api/chat/diagnostics`, `AutonomyMaster.pendingQueue` | Active |
| Autonomy remediation queue | `/api/autonomy/remediations*` + `src/core/autonomy-remediation-queue.mjs` | Active |
| Self-edit safety envelope | `src/core/self-edit-pipeline.mjs` | Active (protected path + canary profile + quality rollback) |
| Mission runtime truth | `src/core/missions.mjs` + `execution_state` | Active, effective-step-limit surfaced |
| Runtime memory truth | `OPENUNUM_HOME/openunum.db` | Active canonical store |
| Working-memory anchors | `OPENUNUM_HOME/working-memory/*.json` | Generated runtime support surface |
| CLI operator surface | `src/cli.mjs` | Active |
| API docs | `docs/API_REFERENCE.md` | Canonical, parity-gated |
| Onboarding docs | `README.md`, `docs/INDEX.md`, `docs/AGENT_ONBOARDING.md` | Canonical |
| Validation gate | `pnpm verify` | Canonical umbrella gate |

## Current Open Debt

- deeper frontend decomposition is still desirable in some larger settings/runtime modules
- operator dashboard can be further split into dedicated modules for autonomy cards/remediation actions
- some legacy modules remain for compatibility and should continue moving toward archive-only status when safe
