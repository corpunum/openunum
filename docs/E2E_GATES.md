# E2E Gates (Mandatory)

## Phase 0
- start service
- `openunum health` -> `ok`

## Phase 1
- provider smoke tests:
  - Ollama returns completion
  - OpenRouter returns completion
  - NVIDIA returns completion
- hot-switch model in active session

## Phase 2
- agent can create/edit/read file
- agent can run `uname -a` and parse result

## Phase 3
- connect CDP at `127.0.0.1:9222`
- open URL and capture content

## Phase 4
- memory survives restart
- retrieval returns expected prior fact

## Phase 5
- inbound Telegram message -> agent response
- inbound WhatsApp message -> agent response

## Phase 6
- desktop web UI functional
- mobile browser UI functional

## Phase 7
- reboot recovery
- full regression run passes

## Phase 8
- reviewed skills lifecycle works end-to-end:
  - install -> review -> approve -> execute -> uninstall
- email integration status endpoint works (`googleworkspace/cli`)
- research pipeline run works (`simulate=true`) and queue is populated
- autonomy master status and cycle endpoints respond successfully

## Deploy Gate
- `pnpm test:all`
- `node tests/self-test-runner.mjs`
- `pnpm deploy:gate`
