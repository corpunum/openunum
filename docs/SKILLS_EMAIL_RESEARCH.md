# Skills, Email, Research

## Skills (Reviewed Execution)

OpenUnum supports managed local skills under `~/.openunum/skills/custom`.

Lifecycle:

1. Install (`/api/skills/install`)
2. Review (`/api/skills/review`)
3. Approve (`/api/skills/approve`) if not auto-safe
4. Execute (`/api/skills/execute`)
5. Uninstall (`/api/skills/uninstall`)

Manifest:

- `~/.openunum/skills/manifest.json`
- tracks verdict, findings, approvals, and usage metrics.

Security notes:

- Static checks include `eval`, `Function`, `child_process`, file write patterns, and network access signals.
- Rejected skills cannot be approved.

## Google Workspace / Gmail

Integration uses `googleworkspace/cli` (`gws`).

Setup:

1. Install CLI:
   `npm install -g @googleworkspace/cli`
2. Authenticate:
   `gws auth setup`
3. Verify:
   `GET /api/email/status`

Supported APIs:

- `POST /api/email/send`
- `POST /api/email/list`
- `POST /api/email/read`
- `POST /api/gworkspace/call` for generic Workspace API commands.

## Daily Research Pipeline

Research manager runs internet scans for agent-improvement tactics and stores findings.

Endpoints:

- `POST /api/research/run`
- `GET /api/research/recent`
- `GET /api/research/queue`
- `POST /api/research/approve`

Storage:

- reports: `~/.openunum/research/research-YYYY-MM-DD.json`
- review queue: `~/.openunum/research/review-queue.json`

Adoption rule:

- research findings are `pending_review` until explicitly approved.

