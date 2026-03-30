# UI Behavior

UI source: `src/ui/index.html`

## 1. Structure

- Left fixed menu with categories/submenus
- Center dynamic panel switched by selected submenu
- Chat is a dedicated center view

Views:
- Chat
- Operator Tools
- Model Routing
- Provider Config
- Browser Control
- Telegram
- Missions

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
- `/auto <goal>` command in chat: starts a mission loop and auto-polls until completion
- default auto-escalation toggle (`Auto: On/Off`) in chat header:
  when enabled, planning-style replies are automatically escalated into mission continuation
- live activity toggle (`Live: On/Off`) in chat header:
  during pending execution, shows expandable real-time tool calls/results so users can distinguish
  between active progress vs stuck/failing behavior

Trace panel includes:
- provider/model
- per-step tool calls
- tool args
- tool result summary

## 4. Mission UI

- start/stop/refresh controls
- status line with step progression
- active mission id persisted in localStorage

## 5. State Handling

Local browser storage keys:
- `openunum_session`
- `openunum_mission`

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
