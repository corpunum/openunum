# Current State Matrix (2026-04-08)

This matrix is the quick trust checkpoint for code, tests, docs, and CI.

| Surface | Canonical Source | Status |
|---|---|---|
| Runtime server/API behavior | `src/server.mjs` + `src/server/routes/*` | Active |
| Web UI behavior | `src/ui/index.html` | Active |
| Legacy/preview UI | `src/ui/new_ui.html` | Legacy preview only |
| Model/provider defaults | `src/config.mjs` + `/api/config` | Active |
| API contract docs | `docs/API_REFERENCE.md` | Updated to implemented endpoints + planned section |
| Onboarding docs | `README.md`, `docs/INDEX.md`, `docs/AGENT_ONBOARDING.md` | Updated for council-size/phase status consistency |
| CI baseline gates | `.github/workflows/phase-gates.yml` | Expanded (unit, smoke, UI smoke, imitation, core e2e, phase0 gates) |
| Known architectural debt | route abstraction split + polling-first UI + oversized `index.html` | Open |

## Minimum Local Trust Gate

Run before release-sensitive changes:

```bash
pnpm test:unit
pnpm test:smoke
pnpm smoke:ui:noauth
pnpm test:imitation
pnpm e2e
pnpm docs:gate
```

