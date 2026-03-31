# Ultimate Autonomy Model

This document defines the operating model for OpenUnum as a high-autonomy owner-serving assistant.

## Core Principles

1. Owner-first execution with proof-backed outcomes.
2. High autonomy with explicit control modes.
3. Learn from failures and successes every cycle.
4. No risky auto-adoption: research and skills require review.
5. Test gates before deployment.

## Owner Control Modes

- `safe`: blocks privileged system-changing commands without explicit mode change.
- `owner-unlocked`: allows privileged operational commands.
- `owner-unrestricted`: highest autonomy for owner-authorized sessions.

Configured through `runtime.ownerControlMode`.

## Proof and Completion Rules

- Task completion is trusted only with tool evidence.
- Mission completion requires net-new successful tool runs.
- "Done" text with no evidence is treated as retry or failure.

## Self-Poke Behavior

- On successful mission completion and `runtime.selfPokeEnabled=true`, OpenUnum records a concrete next improvement prompt.
- Self-poke outputs are persisted as strategy outcomes for future planning.

## Continuous Autonomy

`AutonomyMaster` can run continuous cycles for:

- health checks and self-heal attempts
- quick tests
- auto-improvement analysis
- skill learning from successful patterns
- predictive issue handling

Control via:

- `POST /api/autonomy/master/start`
- `POST /api/autonomy/master/stop`
- `GET /api/autonomy/master/status`

