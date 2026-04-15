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
