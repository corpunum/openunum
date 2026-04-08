# OpenUnum Agent Onboarding Guide

## Architecture Overview

### Core Files
| File | Purpose | Size |
|------|---------|------|
| `src/core/agent.mjs` | Main controller loop, turn execution, context building | ~60KB |
| `src/core/missions.mjs` | Mission management, proof-aware completion | ~40KB |
| `src/core/context-pack-builder.mjs` | System message construction | - |
| `src/core/execution-contract.mjs` | Completion detection logic | ~46 lines |
| `src/memory/store.mjs` | SQLite session/message/fact storage | - |
| `src/ui/index.html` | Web UI (inlined CSS/JS) | - |

### Session Storage
- **Database**: `openunum.db` (SQLite via `node:sqlite` - DatabaseSync)
- **Tables**: `sessions`, `messages`, `facts`, `tool_runs`
- **API**: `GET /api/sessions/{sessionId}` returns full session with messages
- **Default Port**: 18880

### Key Functions
- `shouldForceContinuation()` - Decides if agent should keep working (line ~1001)
- `isProofBackedDone()` - Validates completion claims (line ~1205)
- `getContextStatus()` - Builds context for current turn (line 675)
- `getMessagesSince()` - Retrieves session messages (route handler)

## UI Architecture

**Main file:** `src/ui/index.html` (includes inlined CSS/JS)
**Key components:**
- Chat panel (messages display)
- Sessions panel (left sidebar)
- Status bar (top)

**Known issues:**
- Long responses require scrolling
- No expand/collapse for verbose outputs
- No progress indicators during tool execution

## Anti-Stuck Rules (Learned from Session 61df6ffd)

1. **Never claim done without tool evidence** — Only "Complete ✅" when tool output confirms
2. **Execute immediately after proposing** — No "Shall I proceed?" — just go
3. **Always show progress** — Use ⏳ between tool calls, end with next action
4. **Keep responses concise** — Max 10 lines, tables > paragraphs
5. **Retry on failure** — Tool fails → try alternative immediately

Full analysis: `docs/session-stuck-patterns.md`

## UI Reflow Fix (2026-04-03)

**Problem:** After streaming completes, markdown/code blocks render with wrong layout (scrollbars, overflow). On page refresh they format correctly.

**Root cause:** Browser doesn't recalculate layout after `innerHTML` assignment during streaming.

**Fix:** Added `void typing.bubble.offsetHeight;` after `typing.bubble.innerHTML = assistantHtml;` at line 3248 in `index.html`. This forces a synchronous reflow so the browser recalculates element dimensions.

## Recent Changes (2026-04-03)

### 1. Proof Scorer Module
- **File**: `src/core/proof-scorer.mjs` (NEW)
- **Purpose**: Score proof quality 0.0-1.0 based on 4 weighted checks
- **Weights**: Tool success (0.3), Output relevance (0.3), Goal alignment (0.2), No errors (0.2)
- **Status**: Shadow logging active at `shouldForceContinuation` and `isProofBackedDone`
- **Integration**: Import at agent.mjs line 29, logging at lines ~1012 and ~1215

### 2. Memory Recall Module
- **File**: `src/core/memory-recall.mjs` (NEW)
- **Purpose**: Query stored artifacts by relevance to current goal
- **Functions**: `recallRelevantArtifacts()`, `formatRecalledContext()`
- **Status**: Shadow logging active in context building flow
- **Integration**: Import at agent.mjs line 23, logging at line ~910

## Session Storage (Found 2026-04-03)

**Database:** `/home/corp-unum/openunum/openunum.db` (SQLite via `node:sqlite`)
**Library:** `better-sqlite3` (synchronous, not CLI sqlite3)

**Tables:**
- `sessions` — Session metadata (id, title, created_at, updated_at)
- `messages` — Chat history (session_id, role, content, tool_calls, created_at)
- `facts` — Extracted facts (session_id, key, value, source_ref)
- `tool_runs` — Tool execution logs (session_id, tool_name, args, result, ok)

**API Endpoints:**
- `GET /api/sessions` — List all sessions
- `GET /api/sessions/{fullSessionId}` — Get session + messages
- `DELETE /api/sessions/{id}` — Delete session

**Default port:** 18880

**To read a session:**
```bash
curl http://localhost:18880/api/sessions/{sessionId}
```

## Debugging Tips

### Reading Session History
```bash
# Via API (server must be running on port 18880)
curl http://localhost:18880/api/sessions/{full-session-id}

# Session list
curl http://localhost:18880/api/sessions
```

### Common Issues
1. **Stuck turns**: Check `trace.proofScorer` for confidence scores
2. **Lost context**: Check `trace.memoryRecall` for artifact retrieval
3. **DB empty**: Server may not have initialized MemoryStore yet

### Tool Restrictions
- `shell_run` may be restricted by model execution profile
- Use `file_read`, `file_write`, `file_patch` for file operations
- Use `http_request` for API calls when available

## Design Principles

1. **Shadow mode first**: New features log but don't affect behavior
2. **Proof-backed completion**: Claims require tool evidence
3. **Additive changes**: Don't break existing flow
4. **Model-agnostic**: Logic works with any provider

## File Structure
```
openunum/
├── src/
│   ├── core/
│   │   ├── agent.mjs           # Main controller
│   │   ├── missions.mjs        # Mission management
│   │   ├── proof-scorer.mjs    # NEW: Proof quality scoring
│   │   └── memory-recall.mjs   # NEW: Artifact recall
│   ├── memory/
│   │   └── store.mjs           # SQLite storage
│   ├── server/
│   │   └── routes/
│   │       └── sessions.mjs    # Session API routes
│   └── ui/
│       └── index.html          # Web interface
├── docs/
│   └── agent-onboarding.md     # THIS FILE
└── openunum.db                 # SQLite database
```
