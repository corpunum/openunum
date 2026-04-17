# Current State Matrix (2026-04-17)

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
| Audit truth | `OPENUNUM_HOME/audit/audit-log.jsonl` | Active canonical store |
| Working-memory anchors | `OPENUNUM_HOME/working-memory/*.json` | Generated runtime support surface |
| CLI operator surface | `src/cli.mjs` | Active |
| API docs | `docs/API_REFERENCE.md` | Canonical, parity-gated |
| Onboarding docs | `README.md`, `docs/INDEX.md`, `docs/AGENT_ONBOARDING.md` | Canonical |
| Validation gate | `pnpm verify` | Canonical umbrella gate |
| Cloud-primary baseline | `src/config.mjs` + runtime config | Active (`ollama-cloud/qwen3.5:397b-cloud`) |
| Autonomy master auto-start | `src/config.mjs` → `autonomyMasterAutoStart: true` | Active (enabled by default) |
| Memory consolidation triggers | `src/core/autonomy-master.mjs` → time + count | Active (24h interval / 50 memories) |
| Death-spiral detection | `src/core/autonomy-master.mjs` → degraded mode | Active |
| ODD enforcement | `src/core/council/safety-council.mjs` + `src/core/model-execution-envelope.mjs` | Active (provider/model-aware preflight, compact read-only allowlists) |
| Independent verifier | `src/core/verifier.mjs` → tool runtime + agent post-flight | Active |
| Role-model escalation | `src/core/role-model-registry.mjs` → `agent.mjs` | Active (tier-enforced, no permissive fallback) |
| Freshness in retrieval | `src/memory/recall.mjs` → `applyFreshnessAndReturn()` | Active (30% weight) |
| FinalityGadget | `src/core/finality.mjs` → `tools/runtime.mjs` | Active (stable persisted confirmation history for tracked operations) |
| Audit HMAC secret | `src/core/audit-log.mjs` → 3-tier resolution | Active (env > file > fallback with warning) |
| Config parity/provider truth | `src/core/config-parity-check.mjs` | Active (errors on disabled active primary / forced invalid routing) |
| Health/self-heal surface | `src/core/self-heal.mjs` + `src/server/routes/health.mjs` | Active (bounded checks, non-recursive `/api/health`, strict `/api/health/check`) |

## Current Open Debt

- deeper frontend decomposition is still desirable in some larger settings/runtime modules
- operator dashboard can be further split into dedicated modules for autonomy cards/remediation actions
- local-first controller cutover is still deferred; the current stable operational baseline is cloud-primary on `ollama-cloud/qwen3.5:397b-cloud`
- local model integration for verifier and role-model escalation deferred (using cloud models for now)
- finality is now stable and persisted, but destructive flows are still not a full prepare/commit transaction system
