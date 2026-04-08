# Phase 0 Execution Plan (Started 2026-04-08)

## Outcome Target
Phase 0 creates strict foundations for all later remediation work:
1. Canonical runtime state contract.
2. Deterministic config/source parity checks.
3. Explicit 4B-readiness budget gates.

## Scope (what this plan covers)
- OpenUnum-only implementation steps and acceptance gates.
- No architecture rewrite.
- No new daemon/service requirements.

## Backlog

### Epic A: Canonical Runtime State
- [x] A1. Add runtime state contract module with normalization + validation.
- [x] A2. Add deterministic state fingerprint generation.
- [x] A3. Wire runtime state packet into mission/session runtime responses.
- [x] A4. Add API exposure for packet + contract version.

Acceptance
- Contract version is explicit and stable.
- Required fields are enforced before packet publish.
- Fingerprint is deterministic for semantically equivalent payloads.

### Epic B: Config Parity + Source Coherence
- [x] B1. Add config parity analyzer for active/fallback providers.
- [x] B2. Add provider matrix in report (base URL present, key present, source).
- [x] B3. Add script to run parity + runtime contract checks.
- [x] B4. Expose parity report via API endpoint for Web UI/runtime diagnostics.

Acceptance
- Missing provider-model mappings are surfaced as errors.
- Missing non-ollama API keys are surfaced as warnings.
- Workspace and fallback-chain sanity checks are included.

### Epic C: 4B Readiness Gate
- [x] C1. Add explicit compact-profile checks (history/tool-iteration budgets).
- [x] C2. Add context compaction gate check.
- [x] C3. Add CI/Deploy gate requiring 4B readiness for compact profile changes.

Acceptance
- Compact profile violations show clear warning/error codes.
- Phase0 check command exits non-zero on hard errors.

### Epic D: Rollout + Observability
- [x] D1. Add `/api/runtime/state-contract` + `/api/runtime/config-parity` endpoints.
- [x] D2. Add UI diagnostics panel for Phase 0 checks.
- [x] D3. Add runbook entries for operator triage workflow.

Acceptance
- Operators can run checks from CLI and UI.
- Check outputs are versioned, machine-readable, and stable.

## New Artifacts Added in this kick-off
- `src/core/runtime-state-contract.mjs`
- `src/core/config-parity-check.mjs`
- `scripts/phase0-foundation-check.mjs`
- `scripts/compact-profile-gate.mjs`
- `.github/workflows/phase-gates.yml`
- `tests/unit/runtime-state-contract.test.mjs`
- `tests/unit/config-parity-check.test.mjs`
- `tests/unit/runtime-wiring-routes.test.mjs`

## Immediate Commands
```bash
pnpm test:unit
node scripts/phase0-foundation-check.mjs
```

## Status
Phase 0 core backlog is complete as of 2026-04-08.
