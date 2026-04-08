# Repo Harvest Consolidated Plan (2026-04-08)

Scope: Harvest practical ideas from `stephengpope/thepopebot` and `NousResearch/hermes-agent`, then map only high-value, architecture-compatible actions to OpenUnum.

## Why these inputs matter
- `thepopebot` contributes pragmatic deployment and operator UX patterns (setup, upgrade, webhook/chat split, Git-backed job lifecycle).
- `hermes-agent` contributes memory/provider modularity, platform-aware tool surfaces, and observed weak-model/tool-calling failure modes.

## Harvested patterns worth adopting in OpenUnum

1. Tool-surface minimization per platform/session
- Source pattern: Hermes issue reports show large tool schemas can heavily degrade local model latency and reliability.
- OpenUnum action: Make tool exposure profile-aware and endpoint-aware by default, with explicit allowlists and strict omission of unused tool schemas.

2. Parse robustness for tool-calling fallbacks
- Source pattern: Hermes issue reports malformed tool-call payloads and parser fragility under heavy context/tool lists.
- OpenUnum action: Add strict parser recovery ladder (native function-call -> tolerant extraction -> reject with actionable error), never silently accept hallucinated tool output.

3. Runtime diagnostics as first-class API contracts
- Source pattern: Both repos expose substantial runtime/config control and diagnostics surfaces.
- OpenUnum action: Keep versioned runtime contracts and parity checks available via read-only API and CLI. (Phase 0 D1 now implemented.)

4. Secrets and runtime hardening boundaries
- Source pattern: thepopebot issues highlight Docker socket and secrets-at-rest concerns.
- OpenUnum action: Prioritize secrets-at-rest hardening and execution boundary checks before adding new autonomy complexity.

5. Installation/update/operator ergonomics
- Source pattern: thepopebot setup/upgrade flows reduce operator friction.
- OpenUnum action: Consolidate one canonical bootstrap+upgrade flow with deterministic env/config validation and recovery paths.

6. Pluggable memory providers with strict contracts
- Source pattern: Hermes memory provider ecosystem moves quickly, but risk of overlap and tool bloat is real.
- OpenUnum action: Keep one canonical runtime state; allow optional memory adapters only via one strict provider contract and latency budget checks.

## What we should not import
- No competing "memory brains" or duplicated truth stores.
- No XML-only tool-calling dependency as the primary path.
- No framework stacking that blurs ownership.

## OpenUnum execution plan

## Phase 0 (in progress)
1. Canonical runtime state contract + fingerprint.
2. Config/source parity report + 4B compact-profile gate.
3. Runtime diagnostics endpoints (`/api/runtime/state-contract`, `/api/runtime/config-parity`).

Exit criteria:
- Contract/parity outputs are versioned, deterministic, and machine-readable.
- Hard failures block checks.

## Phase 1 (next)
1. Tool-surface budget gate:
- Add max tool-schema token budget for compact profile.
- Reject/trim non-essential tool schemas in compact lane.
2. Parser recovery policy:
- Add structured parser fallback for malformed tool-call payloads.
- Add explicit error codes for parser failure classes.
3. Platform/toolset coherence checks:
- Assert configured-disabled toolsets are not injected.

Exit criteria:
- 4B compact lane responds within target latency budget under constrained toolset.
- Tool-calling reliability improves under malformed/mixed outputs.

## Phase 2
1. Secrets-at-rest hardening:
- Encrypted local secret store with key management policy.
- Diagnostics endpoint for secret-source health (without value leakage).
2. Self-heal consolidation:
- Merge overlapping self-heal/recovery surfaces into one orchestrator path.

Exit criteria:
- One recovery owner path, no overlap ambiguity.
- Secret handling has explicit threat-model coverage.

## Phase 3
1. Operator UX consolidation:
- Unified setup/upgrade doctor command set.
- Web UI diagnostics panel consuming Phase 0/1 endpoints.
2. Docs-as-completion gate:
- CI/deploy checks for docs/changelog/tests alignment on runtime-critical changes.

Exit criteria:
- Runtime-critical PRs fail when docs/tests/changelog are out of sync.

## Immediate implementation queue
1. Add Phase 1 tool-schema budget gate for compact profile.
2. Add parser recovery ladder + tests for malformed tool-call payloads.
3. Add UI diagnostics section for state-contract + parity reports.
