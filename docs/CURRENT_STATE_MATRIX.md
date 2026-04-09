# Current State Matrix (2026-04-09)

This matrix is the quick trust checkpoint for code, tests, docs, and CI.

| Surface | Canonical Source | Status |
|---|---|---|
| Runtime server/API behavior | `src/server.mjs` + `src/server/routes/*` | Active |
| Web UI behavior | `src/ui/index.html` + `src/ui/styles.css` + `src/ui/app.js` + `src/ui/modules/*` | Active |
| Legacy/preview UI | `maintenance/ui-legacy/*` | Archived (inactive runtime surface) |
| Model/provider defaults | `src/config.mjs` + `/api/config` | Active |
| CLI operator surface | `src/cli.mjs` | Active (local + API-bridge commands) |
| API contract docs | `docs/API_REFERENCE.md` | Updated to implemented endpoints only |
| Onboarding docs | `README.md`, `docs/INDEX.md`, `docs/AGENT_ONBOARDING.md` | Updated for council-size/phase status consistency |
| CI baseline gates | `.github/workflows/phase-gates.yml` | Canonical (`pnpm verify` after Playwright install) |
| Known architectural debt | deeper frontend decomposition and server composition-root trimming remain optional follow-up improvements | Open |

## Minimum Local Trust Gate

Run before release-sensitive changes:

```bash
pnpm lint
pnpm format:check
pnpm test:unit
pnpm test:smoke
pnpm smoke:ui:noauth
pnpm test:imitation
pnpm e2e
pnpm docs:gate
pnpm docs:index:check
pnpm gate:runtime-surface-contract
pnpm gate:route-wiring
pnpm gate:ui-surface
pnpm gate:repo-hygiene
```
