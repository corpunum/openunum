# Current State Matrix (2026-04-08)

This matrix is the quick trust checkpoint for code, tests, docs, and CI.

| Surface | Canonical Source | Status |
|---|---|---|
| Runtime server/API behavior | `src/server.mjs` + `src/server/routes/*` | Active |
| Web UI behavior | `src/ui/index.html` + `src/ui/styles.css` + `src/ui/app.js` + `src/ui/modules/*` | Active (modularization in progress) |
| Legacy/preview UI | `maintenance/ui-legacy/*` | Archived (inactive runtime surface) |
| Model/provider defaults | `src/config.mjs` + `/api/config` | Active |
| CLI operator surface | `src/cli.mjs` | Active (local + API-bridge commands) |
| API contract docs | `docs/API_REFERENCE.md` | Updated to implemented endpoints + planned section |
| Onboarding docs | `README.md`, `docs/INDEX.md`, `docs/AGENT_ONBOARDING.md` | Updated for council-size/phase status consistency |
| CI baseline gates | `.github/workflows/phase-gates.yml` | Expanded (unit, smoke, UI smoke, imitation, core e2e + phase39/40/41/42/43, phase0 gates, runtime-surface gate, route-wiring gate, ui-surface gate) |
| Known architectural debt | polling-first pending fallback loop | Open |

## Minimum Local Trust Gate

Run before release-sensitive changes:

```bash
pnpm test:unit
pnpm test:smoke
pnpm smoke:ui:noauth
pnpm test:imitation
pnpm e2e
pnpm docs:gate
pnpm gate:runtime-surface-contract
pnpm gate:route-wiring
```
