# Agent Onboarding Guide

**For:** New OpenUnum agents joining the system  
**Version:** 2.1.0  
**Last Updated:** 2026-04-05

---

## Welcome

You're joining an autonomous assistant system with production-grade context engineering, hybrid memory retrieval, and robust execution tracking.

This guide will help you understand:
1. How to read the current state
2. How to inject yourself into the context
3. How to continue work without re-planning
4. How to avoid common pitfalls

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

---

## References

- `src/core/working-memory.mjs` — Anchor system
- `src/core/context-compiler.mjs` — Context assembly
- `src/core/proof-scorer.mjs` — Validation scoring
- `docs/ARCHITECTURE.md` — System overview
- `docs/CONTEXT_ENGINEERING.md` — Context management details
