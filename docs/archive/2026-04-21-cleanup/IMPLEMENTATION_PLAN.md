# OpenUnum v2.2.0 Implementation Plan

**Date:** 2026-04-05  
**Goal:** Architectural consolidation + branchable side quests

---

## Phase 1: Core Architecture Cleanup (Low Risk)

### 1.1 Merge Task Tracker into Working Memory
- **Current:** `task-tracker.mjs` and `working-memory.mjs` both track subplans
- **Action:** Make Working Memory the single source of truth for task state
- **Changes:**
  - Extend `WorkingMemoryAnchor` to include task tracker features
  - Deprecate `task-tracker.mjs` (keep as thin wrapper for backward compat)
  - Update agent to use WM for all task state

### 1.2 Clarify Proof System Ownership
- **Current:** `proof-scorer.mjs`, `completion-checklist.mjs`, `execution-contract.mjs` all judge completion
- **Action:** Clear ownership boundaries
  - `proof-scorer.mjs` → Utility (scoring only)
  - `completion-checklist.mjs` → Step tracking
  - `execution-contract.mjs` → Final judgment owner
- **Changes:**
  - Remove duplicate logic
  - Document clear call chain

### 1.3 Hierarchical Policy Loading
- **Current:** Single `docs/AGENT_ONBOARDING.md`
- **Action:** Implement tiered `AGENTS.md` system
- **Changes:**
  - `AGENTS.md` (root) — Global owner policy
  - `project/AGENTS.md` — Project-specific rules
  - `session/AGENTS.md` — Session-specific objectives
  - Loader merges with clear precedence

---

## Phase 2: Branchable Side Quests (Medium Risk, High Value)

### 2.1 Session Manager Fork/Merge
- **Current:** Linear sessions only
- **Action:** Add fork/merge capability to `session-manager.mjs`
- **Changes:**
  - `forkSession(parentId, purpose)` → creates child session
  - `mergeSession(childId)` → condenses result to parent
  - Track parent/child relationships in session metadata

### 2.2 Side Quest Executor
- **Action:** New module `src/core/side-quest.mjs`
- **Responsibilities:**
  - Spawn side quests for: self-heal, proof-check, repair, memory reconciliation
  - Monitor progress
  - Condense results (max 500 chars summary)
  - Report back to main session

### 2.3 Integrate Side Quests into Agent Loop
- **Action:** Modify `agent.mjs` to use side quests
- **Changes:**
  - Detect when repair/heal/proof needed
  - Fork side quest instead of inline handling
  - Wait for condensation
  - Continue main flow

---

## Phase 3: Small-Model Hardening

### 3.1 Tool Call Validator
- **Action:** New module `src/core/tool-validator.mjs`
- **Responsibilities:**
  - Pre-execution schema validation
  - Post-execution result sanity checks
  - Retry with corrected args on failure

### 3.2 Strict Subplan Isolation for 9B
- **Action:** Extend working memory injection
- **Changes:**
  - For 9B models: show only current subplan steps
  - Hide completed/future subplans from context

---

## Phase 4: Documentation & Tests

### 4.1 Update Agent Onboarding
- **File:** `docs/AGENT_ONBOARDING.md`
- **Add:** Side quest workflow, hierarchical policies, ownership map

### 4.2 Update Architecture Docs
- **File:** `docs/ARCHITECTURE.md`
- **Add:** Three-plane diagram, state separation, side quest flow

### 4.3 Update Changelog
- **File:** `CHANGELOG.md`
- **Add:** v2.2.0 entries

### 4.4 Tests
- **Unit tests:** Side quest fork/merge, hierarchical loading, tool validator
- **E2E tests:** Full workflow with side quests

---

## Rollout Order

1. ✅ Phase 1.3 (Hierarchical Policies) — Lowest risk, immediate value
2. ✅ Phase 1.1 (Task Tracker Merge) — Cleanup
3. ✅ Phase 1.2 (Proof System) — Cleanup
4. ✅ Phase 2.1 + 2.2 (Side Quest Core) — Main feature
5. ✅ Phase 2.3 (Agent Integration) — Wire it up
6. ✅ Phase 3.1 + 3.2 (Small-Model) — Optional hardening
7. ✅ Phase 4 (Docs + Tests) — Complete

---

## Success Criteria

- [ ] Side quests functional (fork → execute → merge)
- [ ] Task tracker overlap resolved
- [ ] Hierarchical policies loading
- [ ] All existing tests pass
- [ ] New tests for side quests pass
- [ ] Docs updated
- [ ] Changelog updated
- [ ] Git committed + pushed
