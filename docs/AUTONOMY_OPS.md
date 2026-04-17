# Autonomy Ops (Canonical)

This is the canonical operator guide for OpenUnum autonomy runtime behavior.

## Core Loop

Autonomy runtime loop:
1. Health check
2. Self-awareness snapshot
3. Nudge generation
4. Predictive failure scan
5. Remediation queue sync
6. Optional self-test / self-improve / skill-learning passes

Primary runtime status endpoint:
- `GET /api/autonomy/master/status`

## Self-Awareness

Self-awareness is computed from recent session quality signals:
- recovery-format leakage (`Status: ok / Findings`)
- generic acknowledgement leakage (`Ready. Tell me what you want to do next.`)

Status payload includes:
- `status.selfAwareness.score`
- `status.selfAwareness.status`
- `status.selfAwareness.metrics`
- `status.selfAwareness.issues`

## Death-Spiral Detection

AutonomyMaster tracks consecutive no-progress cycles (`consecutiveNoProgressCycles`):
- Each cycle where self-awareness score does not improve increments the counter
- When `consecutiveNoProgressCycles >= degradedModeThreshold` (default: 3), enters degraded mode
- Degraded mode: `status.degraded = true`, triggers `ensureRemediationFromDeathSpiral()` auto-remediation
- Remediation entry: type `death_spiral_degraded`, source `autonomy_master`
- Exits degraded mode when a cycle shows progress (self-awareness score improves)

Status payload includes:
- `status.degraded` (boolean)
- `status.consecutiveNoProgressCycles` (number)
- `status.degradedModeThreshold` (number)

## Memory Consolidation Triggers

Consolidation (hippocampal replay) is triggered by:
1. **Time-based**: every `consolidationIntervalMs` (default: 86400000ms = 24 hours)
2. **Count-based**: when new memory artifacts exceed `consolidationMemoryThreshold` (default: 50) since last consolidation
3. **Sleep-based**: during `SleepCycle` idle periods (original trigger, still active)

Both time and count triggers run in `AutonomyMaster.runCycle()`, ensuring consolidation occurs even if the agent never enters sleep mode.

## Pending Queue Watchdog

Pending queue watchdog tracks stalled live chat turns:
- pending count
- stuck count
- oldest pending age
- threshold

Endpoints:
- `GET /api/chat/diagnostics`
- `GET /api/chat/pending?sessionId=...`
- `GET /api/chat/stream?sessionId=...&since=...&turnId=...`

Autonomy status also includes:
- `status.pendingQueue`

## Remediation Queue

Remediation queue is persistent and supports lifecycle transitions.

List and inspect:
- `GET /api/autonomy/remediations?limit=80`
- `GET /api/autonomy/remediations/status?id=...`

Mutations:
- `POST /api/autonomy/remediations/create`
- `POST /api/autonomy/remediations/start`
- `POST /api/autonomy/remediations/resolve`
- `POST /api/autonomy/remediations/fail`
- `POST /api/autonomy/remediations/cancel`
- `POST /api/autonomy/remediations/sync-self-awareness`

Auto-upsert sources:
- degraded self-awareness score
- stalled pending queue

## Self-Edit Safety Envelope

Self-edit pipeline is gated by:
1. protected path policy
2. promotion policy checks
3. bounded canary profile
4. post-change quality-drop guard with rollback

Protected path behavior:
- mutation is blocked unless `elevatedApproval.approved=true` with a non-empty reason

Self-edit endpoints:
- `GET /api/autonomy/self-edit?limit=40`
- `GET /api/autonomy/self-edit/status?id=...`
- `POST /api/autonomy/self-edit/run`

## WebUI Operator Surface

Canonical operator view:
- `view-operator` in `src/ui/index.html`

Surface includes:
- self-awareness card
- pending queue watchdog card
- remediation queue card
- remediation lifecycle controls

## Regression Gates

Key autonomy reliability regressions:
- `node tests/phase51.telegram-imitation-regression.e2e.mjs`
- `node tests/phase52.autonomy-remediation-queue.e2e.mjs`
- `node tests/phase53.chat-diagnostics-watchdog.e2e.mjs`
- `node tests/phase54.self-edit-safety-envelope.e2e.mjs`
- `node tests/phase55.webui-autonomy-dashboard.e2e.mjs`

Canonical umbrella gate:
- `pnpm verify`

## Known Autonomy Failure Modes (2026-04-17)

### Council Revision Death Loop
The council proof-scorer can trigger recursive `runOneProviderTurn` calls for revision. If the revision model call returns empty content (common with Qwen 3.5 thinking-mode responses), the revision result "No response generated." would overwrite good first-response text. Fix: revision `finalText` is only accepted if it is not the "No response generated." fallback.

### Council Mild-Deficit Recursion Noise
Even after overwrite protection, post-flight proof checks could still trigger extra revision turns on small score deficits despite existing tool/verifier evidence. Fix: skip revision when reason is `proof_quality_insufficient`, deficit is mild (`<= 0.08`), and evidence already exists; strict revision still applies to larger deficits.

### Behavior Registry Misclassification
`learnControllerBehavior` can classify tool-free substantive responses as `planner_heavy_no_exec` (e.g., knowledge queries, creative prompts where the model correctly responds without tool calls). This cascades: the `planner_heavy_no_exec` class then causes the system prompt to include planner-directed guidance, degrading future turns. Fix: only classify as planner if no iteration has assistant content >20 chars. Operator remediation: reset the DB entry if the class drifts.
