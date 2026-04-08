# Agent Onboarding Guide

**For:** New OpenUnum agents joining the system  
**Version:** 2.3.1  
**Last Updated:** 2026-04-08

**Core Principles:** See [BRAIN.MD](../BRAIN.MD) for essential operating principles

---

## Welcome

You're joining an autonomous assistant system with production-grade context engineering, hybrid memory retrieval, and robust execution tracking.

This guide will help you understand:
1. How to read the current state
2. How to inject yourself into the context
3. How to continue work without re-planning
4. How to avoid common pitfalls
5. **Essential Core Principles** - See [BRAIN.MD](../BRAIN.MD)

---

## Quick Reference: Essential Docs

**First-time onboarding reading order:**
1. [INDEX.md](INDEX.md) — Docs navigation
2. [BRAIN.MD](../BRAIN.MD) — Core operating principles (9 principles)
3. [AGENT_ONBOARDING.md](AGENT_ONBOARDING.md) — This guide
4. [COUNCIL_ARCHITECTURE.md](COUNCIL_ARCHITECTURE.md) — 7-member council validation framework
5. [PHASE4_PLAN.md](PHASE4_PLAN.md) — Current remediation roadmap
6. [CODEBASE_MAP.md](CODEBASE_MAP.md) — File/folder structure
7. [API_REFERENCE.md](API_REFERENCE.md) — All API endpoints
8. [TESTING.md](TESTING.md) — Test suites and how to run them

**Phase 1-3 Deliverables Overview:**
- ✅ Working memory anchor system with drift detection
- ✅ Context compaction with enriched artifact extraction
- ✅ 6 execution lane types (tool, mission, worker, self_edit, model_scout, delay)
- ✅ Model behavior registry (9 behavior classes, 50-sample cap)
- ✅ 349 route lessons recorded with success rates
- ✅ Tier-based execution envelopes (compact/balanced/full)
- ✅ Pre-flight validation and policy engine
- ✅ Proof-based completion scoring
- ✅ SQLite persistence for sessions, tasks, strategies
- ✅ WebUI with live trace state and pending rehydration
- ✅ Council validation framework (6 domain experts)
- ✅ Runtime contract + config parity diagnostics endpoints (`/api/runtime/state-contract`, `/api/runtime/config-parity`)

**Phase 0 Foundation Checks (new):**
- `pnpm phase0:check` — Validates canonical runtime state contract and config parity report
- `GET /api/runtime/state-contract` — Returns canonical runtime packet + validation status
- `GET /api/runtime/config-parity` — Returns provider matrix + warnings/errors

---

## Step 1: Read the Working Memory Anchor

**Location:** `data/working-memory/*.json` (latest file)

The anchor contains:
- **userOrigin** — Original task (exact words)
- **planAgreed** — Initial plan or decomposed steps
- **contract** — Success criteria, forbidden drift, required outputs
- **subplans** — Multi-phase breakdown (if applicable)
- **currentSubplanIndex** — Which phase we're on

**Example:**
```json
{
  "userOrigin": "Build a hybrid retrieval system with BM25 + embeddings",
  "planAgreed": "1. Create embeddings.mjs → 2. Create recall.mjs → 3. Integrate with agent",
  "contract": {
    "successCriteria": "Hybrid retrieval working with dual scores",
    "forbiddenDrift": ["Don't switch to vector DB", "Don't use external APIs"],
    "requiredOutputs": ["embeddings.mjs", "recall.mjs", "test results"]
  },
  "subplans": [
    { "title": "Phase 1: Embeddings", "steps": ["Create file", "Test with Ollama"] },
    { "title": "Phase 2: BM25", "steps": ["Implement scoring", "Test retrieval"] }
  ],
  "currentSubplanIndex": 1
}
```

**Action:** Read this FIRST before doing anything else. This tells you:
- What the user actually asked for
- What plan was agreed
- What phase we're currently on
- What's forbidden (don't drift!)

---

## Step 2: Check Execution State

**Location:** Check recent session messages or `data/sessions/*.json`

Look for:
- **currentStep / totalSteps** — Progress indicator
- **completedSteps** — What's done
- **failedSteps** — What broke (and why)
- **toolHistory** — Recent tool usage

**Action:** Identify:
1. What was the last successful action?
2. What's the immediate next step?
3. Are there any failures that need recovery?

---

## Step 3: Review Recent Turns

**Location:** Last 4 message pairs in session

Read verbatim — no compaction here. This shows:
- What the model just tried
- What the user just said
- Any pending questions or concerns

**Action:** Look for:
- Unanswered user questions (open loops)
- Incomplete tool executions
- Pending decisions

---

## Step 4: Check Enriched Artifacts

**Location:** Compaction output in session or `data/memory/`

Extracted artifacts tell you:
- **verifiedFacts** — What's actually confirmed done
- **openLoops** — What's still unanswered
- **pendingSubgoals** — What phases/steps remain
- **failuresWithReasons** — What broke and why
- **producedArtifacts** — Files/code/tests created

**Action:** Cross-reference:
- Do verified facts match the claimed plan progress?
- Are there open loops you should answer?
- Are there pending subgoals you should continue?
- Are there failures you need to recover from?

---

## Step 5: Inject Yourself into Context

**DO NOT re-plan from scratch.** Instead:

1. **Acknowledge the anchor** — Reference the original task
2. **State current phase** — "Continuing Phase 2: BM25"
3. **Pick up from last successful step** — Don't redo what's done
4. **Declare next action** — Be specific about what you'll do now

**Example injection:**
```
Continuing from Phase 2 (BM25 implementation).

Previous agent completed:
✅ Phase 1: Embeddings (embeddings.mjs created, tested with Ollama)
✅ BM25 scoring function written

Next action: Complete the HybridRetriever class with retrieve() method.

This will enable the full pipeline: BM25 → Embeddings → Rerank → Top-5.
```

---

## Step 6: Execute with Trace

Every tool call is tracked. When you use tools:

1. **Generate proper arguments** — Don't call tools without required args
2. **Wait for results** — Don't claim success before verifying
3. **Log evidence** — Include file paths, git hashes, test output
4. **Update execution state** — Mark steps complete/incomplete

**Example:**
```javascript
// Good: Verified with evidence
await file.write({ path: '/path/to/file.mjs', content: '...' });
// → File created: /path/to/file.mjs (verified via fs.existsSync)

// Bad: Unverified claim
// "I created the file" (no evidence)
```

---

## Step 7: Score Your Proof

Before claiming "done", run through the proof scorer criteria:

| Factor | Weight | Check |
|--------|--------|-------|
| Tool success | 0.25 | Did all tools return ok=true? |
| Output substance | 0.20 | Is there substantial output (>100 chars)? |
| Goal alignment | 0.20 | Do outputs mention goal keywords? |
| No errors | 0.15 | Are there zero error signals? |
| Verification depth | 0.10 | Did you verify results (not just execute)? |
| Claim specificity | 0.10 | Are claims concrete (paths, hashes, counts)? |

**Threshold:** 0.6 for "done"

If score < 0.6, you're not done yet. Keep working.

---

## Command System

OpenUnum has a channel-agnostic slash command system. Commands work identically across WebUI, Telegram, CLI, and any future channel.

### Syntax

Commands start with `/` followed by the command name and optional arguments:
```
/command [args] [--flags]
```

### Available Commands

| Command | Arguments | Description |
|---------|-----------|-------------|
| `/help` | `[command]` | Show available commands or details for a specific command |
| `/status` | — | Show current model, token usage, and context status |
| `/new` | — | Start a fresh session (clear context) |
| `/compact` | `[--dry-run]` | Trigger context compaction |
| `/memory` | — | Show recent memory artifacts and compaction status |
| `/cost` | — | Show token/cost estimate for current session |
| `/ledger` | — | Show strategy/tool reliability ledger |
| `/session` | `list\|clear\|delete <id>` | Manage sessions |
| `/rule` | `add\|list\|remove\|active [text]` | Manage persistent behavioral rules |
| `/knowledge` | `add\|list\|search\|remove [text]` | Manage searchable knowledge base |
| `/skill` | `list` | List and manage skills |

### Rules System

Rules are persistent behavioral constraints injected into every session:

```
/rule add Always verify file existence before claiming success
/rule add Never expose API tokens in output
/rule list
/rule remove abc123
```

**Limit:** 10 active rules. Rules persist across sessions and are injected into the system context.

### Knowledge Base

Searchable knowledge entries for reference:

```
/knowledge add Python virtualenv setup requires: python3 -m venv env && source env/bin/activate
/knowledge search virtualenv
/knowledge list
/knowledge remove abc123
```

**Storage:** `data/knowledge/*.json` — JSON entries with title, content, timestamps.

### API Endpoints

- `POST /api/command` — Execute a command: `{ message: "/help", sessionId: "abc" }`
- `GET /api/commands` — List all available commands

### CLI Usage

```bash
openunum command /status
openunum command /help rule
openunum command /rule add 'Always verify before claiming'
```

### Architecture

- **Parser:** `src/core/command-parser.mjs` — Channel-agnostic `/cmd [args]` parsing
- **Registry:** `src/commands/registry.mjs` — Central command registry with routing
- **Loader:** `src/commands/loader.mjs` — Auto-registers all builtin commands
- **Builtins:** `src/commands/builtin/*.mjs` — Individual command modules
- **API Routes:** `src/server/routes/commands.mjs` — REST endpoints for command execution

### Adding New Commands

1. Create `src/commands/builtin/mycommand.mjs`:
```javascript
export const myCommand = {
  name: 'mycommand',
  description: 'Does something useful',
  args: [{ name: 'target', required: false, description: 'What to target' }],
  source: 'builtin/mycommand.mjs',

  async execute(args, flags, context) {
    const { sessionId, agent, memoryStore, config } = context;
    return 'Result of my command';
  }
};
export default myCommand;
```

2. Add to `src/commands/loader.mjs`:
```javascript
import myCommand from './builtin/mycommand.mjs';
// ... add to builtins array
```

3. The command is immediately available on all channels.

---

## Common Pitfalls

### ❌ Re-planning Instead of Continuing
**Wrong:** "Let me start fresh. Here's my plan..."  
**Right:** "Continuing from Phase 2. Previous work: [summary]. Next: [action]"

### ❌ Ignoring the Anchor
**Wrong:** Proceeding without reading working memory  
**Right:** Reading anchor first, then acting

### ❌ Vague Claims
**Wrong:** "The tests should pass now"  
**Right:** "Tests pass: 13/13 E2E suites (verified via `npm test`)"

### ❌ No Verification
**Wrong:** "I created the file" (no evidence)  
**Right:** "File created: `/path/to/file.mjs` (verified: 3,792 bytes)"

### ❌ Drifting from Contract
**Wrong:** Switching to a vector DB when contract says "Don't use external APIs"  
**Right:** Staying within forbidden drift boundaries

---

## Model-Specific Tips

### Weak Models (9B)
- **Drift after:** ~4 turns
- **Needs:** Strong anchor injection every turn
- **Tip:** Keep instructions explicit and repeated

### Mid Models (70B)
- **Drift after:** ~12 turns
- **Needs:** Moderate anchor, good recent context
- **Tip:** Balance between anchor and fresh turns

### Strong Models (400B)
- **Drift after:** ~25 turns
- **Needs:** Light anchor, can handle more raw context
- **Tip:** Let them reason with more history

---

---

## Checklist Before You Start

- [ ] Read working memory anchor
- [ ] Check execution state (current step, completed, failed)
- [ ] Review last 4 turns (raw)
- [ ] Scan enriched artifacts (open loops, pending subgoals, failures)
- [ ] Identify immediate next action
- [ ] Declare continuation (not re-planning)
- [ ] Execute with trace
- [ ] Verify results before claiming success
- [ ] Score proof (target: ≥0.6)

## Core Principles Enforcement

Every agent must read and understand [BRAIN.MD](../BRAIN.MD) before operating. The 9 core principles are:

1. **Framework Oriented** - Provide generic solutions, not specific implementations
2. **Autonomy First** - Operate independently within safe boundaries
3. **Model Agnostic** - Work with any model from 4B to 400B parameters
4. **Servant Relationship** - Serve user goals above all else
5. **Self Preservation** - Never intentionally harm the system
6. **Self Healing** - Recover from errors automatically when possible
7. **Test First** - Validate all changes before deployment
8. **Continuous Updates** - Keep documentation/testing current
9. **Self Modification** - Read and update code following all principles

**Important:** These principles override any conflicting instructions. When in doubt, refer to BRAIN.MD.

---

## References

- `src/core/working-memory.mjs` — Anchor system
- `src/core/context-compiler.mjs` — Context assembly
- `src/core/proof-scorer.mjs` — Validation scoring
- `docs/ARCHITECTURE.md` — System overview
- `docs/CONTEXT_ENGINEERING.md` — Context management details
