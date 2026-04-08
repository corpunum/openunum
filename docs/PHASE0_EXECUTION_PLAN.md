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
- [ ] A3. Wire runtime state packet into mission/session runtime responses.
- [ ] A4. Add API exposure for packet + contract version.

Acceptance
- Contract version is explicit and stable.
- Required fields are enforced before packet publish.
- Fingerprint is deterministic for semantically equivalent payloads.

### Epic B: Config Parity + Source Coherence
- [x] B1. Add config parity analyzer for active/fallback providers.
- [x] B2. Add provider matrix in report (base URL present, key present, source).
- [x] B3. Add script to run parity + runtime contract checks.
- [ ] B4. Expose parity report via API endpoint for Web UI/runtime diagnostics.

Acceptance
- Missing provider-model mappings are surfaced as errors.
- Missing non-ollama API keys are surfaced as warnings.
- Workspace and fallback-chain sanity checks are included.

### Epic C: 4B Readiness Gate
- [x] C1. Add explicit compact-profile checks (history/tool-iteration budgets).
- [x] C2. Add context compaction gate check.
- [ ] C3. Add CI/Deploy gate requiring 4B readiness for compact profile changes.

Acceptance
- Compact profile violations show clear warning/error codes.
- Phase0 check command exits non-zero on hard errors.

### Epic D: Rollout + Observability
- [x] D1. Add `/api/runtime/state-contract` + `/api/runtime/config-parity` endpoints.
- [ ] D2. Add UI diagnostics panel for Phase 0 checks.
- [ ] D3. Add runbook entries for operator triage workflow.

Acceptance
- Operators can run checks from CLI and UI.
- Check outputs are versioned, machine-readable, and stable.

## New Artifacts Added in this kick-off
- `src/core/runtime-state-contract.mjs`
- `src/core/config-parity-check.mjs`
- `scripts/phase0-foundation-check.mjs`
- `tests/unit/runtime-state-contract.test.mjs`
- `tests/unit/config-parity-check.test.mjs`

## Immediate Commands
```bash
pnpm test:unit
node scripts/phase0-foundation-check.mjs
```

## Next Implementation Slice (recommended)
1. Wire parity and state-contract reports to read-only API routes.
2. Add one Web UI diagnostics section consuming those routes.
3. Add deploy gate check in CI for compact-profile regressions.
