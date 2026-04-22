# UI Behavior

UI source: `src/ui/index.html`, `src/ui/app.js`, `src/ui/modules/*`, `src/ui/assets/openunum/*`

## 1. Structure

- **Chat-first shell**: `view-chat` is the full-time main center view
- **Collapsible sidebar** with grouped categories and non-repeating labels; toggle/collapse buttons; state persisted in localStorage (`openunum_sidebar_collapsed`)
  - `Chat`
  - `Missions`
  - `Runtime`
  - `Settings`
- Center dynamic panel switched by selected submenu (chat always visible)
- **Settings Hub**: Large `<dialog>` modal with left category rail + right content area, opened by the settings gear icon in the header
  - 8 categories: General, Model Routing, Providers & Vault, Runtime & Autonomy, Tools & Skills, Browser/CDP, Channels, Developer
  - All settings views moved into the modal; no inline settings views remain in the main layout

Views (main layout):
- Chat Terminal (always-visible default)
- Execution Trace
- Mission Runner

Views (settings hub categories):
- General
- Model Routing
- Providers & Vault
- Runtime & Autonomy
- Tools & Skills
- Browser/CDP
- Channels
- Developer

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
- **Token-by-token streaming**: `chatStream()` delivers SSE tokens incrementally for real-time rendering
- **Reasoning/thinking panel**: purple `<details class="reasoning">` collapsible shows model's thinking tokens; reasoning accumulates across all provider turns with `---` separator (renders as `<hr>` in markdown)
- **Raw Response panel**: blue `<details class="raw-response">` collapsible shows raw model output before normalization
- **Tool call cards**: status icons rendered inline during streaming view
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

Agent event bus: `src/core/agent-events.mjs` emits real-time SSE events consumed by the streaming chat UI.

DB persistence: `reasoning` and `raw_reply` columns on the `messages` table (schema v3).

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
- `openunum_sidebar_collapsed`

Persistence behavior:
- chat/session history is stored locally in SQLite on server side (`~/.openunum/openunum.db`)
- history remains available until user explicitly starts a new session via `New Chat`

## 6. Initialization Sequence

Lazy bootstrap: 5 essential steps on page load, 10 deferred steps run when their settings category is first opened.

Essential (on load):
1. refresh model
2. refresh runtime
3. refresh provider config
4. load session messages
5. refresh mission state

Deferred (on first category open):
6. refresh browser config
7. refresh telegram
8. refresh tools/skills
9. refresh channels
10. refresh developer settings
11. refresh model routing detail
12. refresh provider vault detail
13. refresh runtime/autonomy detail
14. refresh browser/CDP detail
15. refresh general settings detail

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

## 9. Static Assets & Branding

Static asset serving extended to include: `.png`, `.gif`, `.webp`, `.svg`, `.ico`, `.woff2`, `.woff`, `.ttf`

Brand assets in `src/ui/assets/openunum/`:
- `icon.png` — favicon and brand icon
- `loading.gif` — loading animation
- `processing.gif` — processing animation
- `downloading.gif` — download progress animation
- `working.gif` — working/active animation

Favicon is set to the brand icon.
