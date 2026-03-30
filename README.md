# OpenUnum

OpenUnum is an Ubuntu-first autonomous assistant framework focused on high tool reliability, strict model control, and agent-operable runtime behavior.

Current state (2026-03-30):
- Web UI with menu/submenu navigation and chat-centered workflow
- Visible/traceable tool execution from chat (expand/collapse execution traces)
- Multi-provider model handling with strict primary-provider lock option
- Browser automation via Chrome DevTools Protocol (CDP)
- Telegram channel loop
- Mission runner with retry and proof-based completion
- Persistent self-learning memory from tool outcomes and strategy outcomes
- Autonomy mode presets (`standard`, `relentless`)
- Pending chat handling (`/api/chat` + `/api/chat/pending`) to avoid "stuck loading"
- Local session history persistence in SQLite until user clicks `New Chat`

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
- http://127.0.0.1:18880

4. Optional full test gate:
```bash
pnpm e2e
```

## New Session Onboarding (for another agent)

Read in this exact order:
1. [docs/INDEX.md](/home/corp-unum/openunum/docs/INDEX.md)
2. [docs/AGENT_ONBOARDING.md](/home/corp-unum/openunum/docs/AGENT_ONBOARDING.md)
3. [docs/CODEBASE_MAP.md](/home/corp-unum/openunum/docs/CODEBASE_MAP.md)
4. [docs/API_REFERENCE.md](/home/corp-unum/openunum/docs/API_REFERENCE.md)
5. [docs/AUTONOMY_AND_MEMORY.md](/home/corp-unum/openunum/docs/AUTONOMY_AND_MEMORY.md)
6. [docs/OPERATIONS_RUNBOOK.md](/home/corp-unum/openunum/docs/OPERATIONS_RUNBOOK.md)

## Commands

```bash
pnpm start
pnpm e2e
node src/cli.mjs health
node src/cli.mjs chat --message "hello"
node src/cli.mjs model switch --provider ollama --model ollama/qwen3.5:397b-cloud
```

## Deployment

- User service file: [deploy/openunum.service](/home/corp-unum/openunum/deploy/openunum.service)
- Installer script: [scripts/install-systemd.sh](/home/corp-unum/openunum/scripts/install-systemd.sh)

## Security / Control Notes

- "Relentless" mode increases retries and autonomy but does not bypass OS/session security constraints.
- OpenUnum is configured to prefer truthful completion claims with tool-evidence.
- Strict provider mode can lock execution to the selected model provider.
