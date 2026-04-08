# Session Stuck Patterns Analysis

**Source:** Session `61df6ffd-1e74-477d-974b-1eb31273a738`
**Date:** 2026-04-03
**Pokes needed:** 16 ("you halted?", "done?", "ok?", "go", "proceed", "continue")

## Pattern Breakdown

| Pattern | Count | Root Cause | Fix |
|---------|-------|------------|-----|
| Declared done but not | 9 | Premature completion claims | Never claim done without tool evidence |
| Stopped after proposal | 5 | Plan written but not executed | Execute immediately after proposing |
| Tool failed no retry | 1 | No fallback strategy | Try alternative tool/path on failure |
| Long response no action | 1 | Verbose output, no next step | Keep responses concise, always end with action |

## Rules to Prevent Stuck Patterns

### Rule 1: Never Declare Done Without Evidence
- Only claim "Complete ✅" when tool output confirms it
- Use checklist format: `- [x] done item` with tool proof
- If unsure, say "In Progress" not "Complete"

### Rule 2: Execute Immediately After Proposing
- Don't write "Shall I proceed?" — just proceed
- If approval needed, say "Need approval for X" then stop
- Otherwise: propose → execute in same turn

### Rule 3: Always Show Progress
- Use `⏳ Working...` between tool calls
- End every response with concrete next action
- Never end with just a summary

### Rule 4: Keep Responses Concise
- Max 10 lines for status updates
- Use tables for comparisons
- Use bullet points, not paragraphs
- Put details in files, not chat

### Rule 5: Retry on Failure
- If tool fails, try alternative immediately
- `shell_run` fails → try `http_request`
- `file_read` fails → try `shell_run cat`
- Log failure, don't just report it

## Implementation

These rules should be added to:
1. `src/core/execution-contract.mjs` — completion detection
2. `src/core/agent.mjs` — turn loop behavior
3. `docs/agent-onboarding.md` — agent training
