# OpenUnum

OpenUnum is an Ubuntu-first autonomous assistant framework focused on high tool reliability, strict model control, and agent-operable runtime behavior.

**Current State (2026-04-08):**
- ✅ **Phase 1-4 Complete** — Working memory, context compaction, model behavior registry, execution envelopes, council remediation
- Web UI with Gemini-inspired glass styling while preserving full backend feature coverage
- Visible/traceable tool execution from chat (expand/collapse execution traces)
- Multi-provider model handling with strict primary-provider lock option
- Model-execution envelopes (`compact` / `balanced` / `full`) to constrain tool/memory exposure for smaller models
- Autonomous execution-policy engine with self-preservation defaults and local file-restore path (`file_restore_last`)
- Browser automation via Chrome DevTools Protocol (CDP)
- Telegram channel loop
- Mission runner with retry and proof-based completion
- Persistent self-learning memory from tool outcomes, strategy outcomes, and route-signature lessons
- Manual model-behavior controls (override/reset) for operator correction
- Autonomy mode presets (`standard`, `relentless`)
- Pending chat handling (`/api/chat` + `/api/chat/pending`) to avoid "stuck loading"
- Session-aware pending handling in UI to prevent cross-session reply bleed when switching chats
- Local session history persistence in SQLite until user clicks `New Chat`
- **Council Validation Framework** — 6 domain experts, latest consolidated maturity tracked in `OPENUNUM_EXPLAINED.md`
- **Phase 0 Runtime Foundations** — Canonical runtime-state contract + config parity diagnostics (`/api/runtime/state-contract`, `/api/runtime/config-parity`)

## Fast Start

1. Install dependencies:
```bash
pnpm install
```

2. Start server:
```bash
node src/server.mjs
```

3. Open Web UI:
- http://127.0.0.1:18880 (Primary Web UI)

4. Optional full test gate:
```bash
pnpm e2e
```

5. Optional isolated API smoke gate (self-starts temp server):
```bash
pnpm test:smoke
```

6. Optional live-service smoke gate (checks running deployment):
```bash
pnpm test:smoke:live
```

7. Optional safe UI smoke gate (no OAuth popups):
```bash
pnpm smoke:ui:noauth
```

8. Phase 0 foundation readiness check:
```bash
pnpm phase0:check
```

## New Session Onboarding (for another agent)

Read in this exact order:
1. [docs/INDEX.md](docs/INDEX.md)
2. [docs/AGENT_ONBOARDING.md](docs/AGENT_ONBOARDING.md)
3. [BRAIN.MD](BRAIN.MD) — Core Operating Principles (9 principles)
4. [docs/COUNCIL_ARCHITECTURE.md](docs/COUNCIL_ARCHITECTURE.md) — Council validation framework
5. [docs/PHASES_MASTER_PLAN_2026-04-08.md](docs/PHASES_MASTER_PLAN_2026-04-08.md) — Canonical phases execution record
6. [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md)
7. [docs/API_REFERENCE.md](docs/API_REFERENCE.md)
8. [docs/AUTONOMY_AND_MEMORY.md](docs/AUTONOMY_AND_MEMORY.md)
9. [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md)
10. [docs/TESTING.md](docs/TESTING.md)

**Quick Reference:**
- **Phase 1-4 Status:** ✅ Complete
- **Council Maturity:** 🟡 Amber (see latest report links in docs index)
- **Next Milestone:** production hardening and runtime/API canonicalization
- **Test Coverage:** 45+ unit, 39 E2E phases, 8 smoke scripts (+ browser-interaction phase gate)

## Commands

```bash
pnpm start
pnpm e2e
pnpm test:smoke
pnpm test:smoke:live
pnpm smoke:ui:noauth
node src/cli.mjs health
node src/cli.mjs status
node src/cli.mjs runtime status
node src/cli.mjs chat --message "hello"
node src/cli.mjs model switch --provider ollama-cloud --model ollama-cloud/minimax-m2.7:cloud
node src/cli.mjs providers list
node src/cli.mjs providers catalog
node src/cli.mjs auth status
node src/cli.mjs auth catalog
node src/cli.mjs missions list
node src/cli.mjs sessions list
```

CLI remote API bridge commands use `OPENUNUM_BASE_URL` (default `http://127.0.0.1:18880`).

## Deployment

- User service file: [deploy/openunum.service](/home/corp-unum/openunum/deploy/openunum.service)
- Installer script: [scripts/install-systemd.sh](/home/corp-unum/openunum/scripts/install-systemd.sh)
- Service restart policy is rate-limited (`StartLimitIntervalSec=120`, `StartLimitBurst=5`) to prevent restart storms on repeated bind failures.

## Security / Control Notes

- "Relentless" mode increases retries and autonomy but does not bypass OS/session security constraints.
- OpenUnum is configured to prefer truthful completion claims with tool-evidence.
- Strict provider mode can lock execution to the selected model provider.

## Provider Credentials + Routing Reality Check

- `GET /api/config` is sanitized; provider key fields are intentionally blank.
- Use `GET /api/providers/config` for provider readiness booleans (`hasOpenrouterApiKey`, `hasNvidiaApiKey`, `hasOpenaiApiKey`).
- Use `GET /api/auth/catalog` for redacted provider/service auth state and source previews.
- If local secrets changed, run `POST /api/auth/prefill-local` to rescan/import provider credentials from local sources.
- Optional encrypted secrets backend:
  - `OPENUNUM_SECRETS_BACKEND=passphrase`
  - `OPENUNUM_SECRETS_PASSPHRASE=<strong passphrase>`
