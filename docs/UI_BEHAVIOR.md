# UI Behavior

UI source: `src/ui/index.html`

## 1. Structure

- Left fixed menu with grouped categories and non-repeating labels:
  - `Chat`
  - `Missions`
  - `Runtime`
  - `Settings`
- Center dynamic panel switched by selected submenu
- Chat is a dedicated center view

Views:
- Chat Terminal
- Execution Trace
- Model Routing
- Provider Vault
- Browser Ops
- Telegram Bridge
- Mission Runner
- Control Plane API

## 2. Dropdown-First Configuration

Global settings are controlled via dropdowns where possible:
- provider selection
- fallback profile
- runtime/autonomy mode
- mission defaults
- CDP endpoint preset

User-defined free text remains for:
- prompts/messages
- API keys/tokens
- one-off command/URL/query inputs

## 3. Chat Experience

- user bubble
- assistant bubble
- animated typing bubble while request is in-flight
- expandable execution trace (`details/summary`)
- duplicate-send guard while one request is active
- pending-run polling: UI continues waiting and resolves from saved session messages
- pending state is tracked per session id, not globally
- session switch is allowed while another session has a pending run
- `/auto <goal>` command in chat: starts a planner-backed generic task and auto-polls until completion
- default auto-escalation toggle (`Auto: On/Off`) in chat header:
  when enabled, planning-style replies are automatically escalated into mission continuation
- live activity toggle (`Live: On/Off`) in chat header:
  during pending execution, shows expandable real-time tool calls/results so users can distinguish
  between active progress vs stuck/failing behavior
  it also keeps an expandable "Attempts & Retries" event log (poll counts, mission restarts, status transitions)
  directly inside the active chat bubble.

Trace panel includes:
- provider/model
- per-step tool calls
- tool args
- tool result summary

## 4. Mission UI

- start/stop/refresh controls
- status line with step progression
- active mission id persisted in localStorage

## 4A. Generic Task UI

- `/auto` no longer posts a fixed one-step mission payload
- chat now sends just the goal plus runtime/base-url hints to `/api/autonomy/tasks/run`
- backend planner decides whether to preflight with:
  - `http_request`
  - `browser_search`
  - `shell_run`
  - optional `model_scout`
  before the mission step
- chat polls `/api/autonomy/tasks/status?id=...` and renders:
  - plan completion state
  - step results
  - verification results
  - monitoring results
- final `/auto` result is written back into the originating chat session as an assistant summary

## 5. State Handling

Local browser storage keys:
- `openunum_session`
- `openunum_mission`
- `openunum_auto_escalate`
- `openunum_live_activity`

Persistence behavior:
- chat/session history is stored locally in SQLite on server side (`~/.openunum/openunum.db`)
- history remains available until user explicitly starts a new session via `New Chat`

## 6. Initialization Sequence

On load:
1. refresh model
2. refresh runtime
3. refresh provider config
4. refresh browser config
5. refresh telegram
6. load session messages
7. refresh mission state

## 7. Mobile Behavior

At smaller widths, layout collapses into stacked menu + center panel while preserving same view logic.

## 8. OAuth-Safe Smoke Testing

Routine UI/API smoke tests should avoid OAuth launch endpoints.

Use:
```bash
pnpm smoke:ui:noauth
```

This intentionally does not call:
- `POST /api/service/connect`
- `POST /api/auth/job/input`
