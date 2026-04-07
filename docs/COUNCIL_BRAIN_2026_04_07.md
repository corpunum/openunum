## Brain-Inspired Architecture Evaluation

**Date:** 2026-04-07  
**Evaluator:** Council Member 1 (Subagent)  
**Scope:** OpenUnum v2.1.0 — `/home/corp-unum/openunum/`

---

### Current State

#### 1. Working Memory System ✅ **IMPLEMENTED**

**Location:** `src/core/working-memory.mjs`

OpenUnum has a robust working memory anchor system designed specifically for weak models (9B parameters) that lose context after 3-4 turns.

**Key Features:**
- **Explicit Anchor Structure:** User origin task, agent's initial plan, success contract, subplans array
- **Drift Prevention:** `detectDrift()` method compares model output against origin keywords and forbidden topics
- **Drift Correction:** `generateDriftCorrection()` produces focus reminders when drift detected
- **Subplan Tracking:** Supports multi-phase tasks with `currentSubplanIndex` and step tracking
- **Persistence:** Anchors saved to `data/working-memory/{sessionId}.json` for session resumption
- **Injection Pipeline:** Builds structured injection with static prefix (cached) + dynamic state (per-turn)
- **Task Steps:** Integrated task tracker with step states (pending/in_progress/completed/failed)

**Injection Structure:**
```
═══ WORKING MEMORY ANCHOR ═══
[USER ORIGIN]: Original task
[PLAN AGREED]: Agent's plan
[SUBPLAN]: Current phase (if multi-phase)
[SUCCESS CRITERIA]: Completion conditions
[FORBIDDEN DRIFT]: Topics to avoid
═══ END ANCHOR ═══

═══ COMPACTED HISTORY ═══
Summarized middle turns with artifact extraction
═══ END COMPACTED ═══

═══ RECENT TURNS ═══
Last 4 turns raw
═══ END RECENT ═══

[CONTINUATION INSTRUCTION]: Mid-execution guidance
```

---

#### 2. Context Compaction ✅ **IMPLEMENTED**

**Location:** `src/core/context-compact.mjs`, `docs/CONTEXT_COMPACTION.md`

OpenUnum has model-aware session compaction with enriched artifact extraction.

**Key Features:**
- **Trigger Policy:** Compacts when usage exceeds `runtime.contextCompactTriggerPct` (default 70%)
- **Target Usage:** Compresses to `runtime.contextCompactTargetPct` (default 40%)
- **Hard Fail Guard:** Stops at `runtime.contextHardFailPct` (default 90%)
- **Preservation Rules:** Recent turns never compacted; user prompts preserved with light truncation
- **Layered Injection:** Context compiler (`src/core/context-compiler.mjs`) assembles in priority order:
  1. Static system instructions (cached)
  2. Execution state (semi-static)
  3. Working memory anchor (dynamic)
  4. Recalled memories (dynamic)
  5. Recent turns (raw, last 4 pairs)

**Enriched Artifact Extraction:**
- `verifiedFacts` — File creates, test passes, git commits
- `openLoops` — Unanswered questions, incomplete tasks
- `pendingSubgoals` — Unfinished phases/steps
- `failuresWithReasons` — Errors with type classification
- `producedArtifacts` — Files, code, tests, docs

**Persistence:**
- Compaction checkpoints stored in `session_compactions` table
- Memory artifacts stored in `memory_artifacts` table

---

#### 3. Hippocampal Replay ⚠️ **PARTIAL**

**Location:** `src/memory/store.mjs`, `src/memory/recall.mjs`

OpenUnum has memory persistence and retrieval but lacks explicit offline replay mechanisms.

**What Exists:**
- **SQLite Memory Store:** Persistent storage for sessions, messages, facts, tool runs
- **Strategy Outcomes:** `recordStrategyOutcome()` and `retrieveStrategyHints()` track what worked/failed
- **Route Lessons:** `recordRouteLesson()` and `getRouteGuidance()` capture successful/failed paths
- **Tool Reliability:** `getToolReliability()` tracks success rates per tool
- **Hybrid Retrieval:** BM25 + embeddings (nomic-embed-text) + cosine reranking
- **Controller Behaviors:** Learned model-specific behaviors stored and retrieved

**What's Missing:**
- ❌ No scheduled replay of successful strategies during idle time
- ❌ No consolidation mechanism that strengthens frequently-used paths
- ❌ No "replay during sleep" for memory optimization
- ❌ No automatic pattern extraction from repeated successes/failures
- ❌ No decay mechanism for unused memories (everything persists equally)

**Evidence:**
```javascript
// Strategy outcome recording exists
recordStrategyOutcome({ goal, strategy, success, evidence })

// But no scheduled replay
// No: replayStrategies(), consolidateMemories(), optimizePaths()
```

---

#### 4. Sleep/Offline Processing ⚠️ **PARTIAL**

**Location:** `src/core/daemon-manager.mjs`, `src/core/worker-orchestrator.mjs`, `src/core/missions.mjs`

OpenUnum has background processing infrastructure but not cognitive sleep cycles.

**What Exists:**
- **Daemon Manager:** Background file watchers, process monitors, HTTP health checks
- **Worker Orchestrator:** Scheduled worker execution with status tracking
- **Mission Scheduling:** Cron-like mission execution with `intervalMs`
- **Health Monitor:** Continuous system health checking
- **Auto-Recover:** Self-healing with retry logic and sleep delays

**What's Missing:**
- ❌ No explicit "sleep mode" for memory consolidation
- ❌ No scheduled offline processing for learning/optimization
- ❌ No rest cycles triggered by session length or token usage
- ❌ No background compaction optimization or index rebuilding
- ❌ No "dream-like" simulation for strategy testing

**Evidence:**
```javascript
// Daemon manager handles external monitors
class DaemonManager {
  // File watchers, process monitors, HTTP checks
  // NOT cognitive processing
}

// No: sleepCycle(), consolidateDuringIdle(), offlineLearning()
```

**Sleep Functions Found:** Only `sleep(ms)` utility for delays, not cognitive rest.

---

#### 5. Attention Mechanisms ⚠️ **PARTIAL**

**Location:** `src/core/working-memory.mjs`, `src/core/context-compiler.mjs`, `src/core/autonomy-coordinator.mjs`

OpenUnum has basic prioritization but lacks dynamic attention weighting.

**What Exists:**
- **Working Memory Focus:** Subplan tracking with `focusSubplan` in injection
- **Context Priority:** Ordered injection pipeline (static → execution → anchor → memories → recent)
- **Memory Relevance:** `recallRelevantArtifacts()` scores by keyword overlap
- **Autonomy Priorities:** `autonomy-coordinator.mjs` uses priority levels (high/medium/low)
- **Drift Detection:** Attention to origin task keywords vs. forbidden topics

**What's Missing:**
- ❌ No explicit salience detection for important events
- ❌ No dynamic attention weighting based on urgency/importance
- ❌ No attention decay for stale topics
- ❌ No multi-objective attention (balancing multiple goals)
- ❌ No attention spotlight mechanism for focused deep work

**Evidence:**
```javascript
// Basic relevance scoring
const relevance = matched.length / goalWords.length;

// But no: salienceScore(), attentionWeight(), priorityDecay()
```

---

### Gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| **No offline replay** | Learned strategies not strengthened; repeated mistakes possible | High |
| **No sleep cycles** | Memory not consolidated; context bloat over long sessions | Medium |
| **No salience detection** | Important events not prioritized; attention scattered | Medium |
| **No memory decay** | All memories persist equally; retrieval noise increases | Low |
| **No dynamic attention** | Cannot shift focus based on urgency or progress | Medium |
| **No pattern extraction** | Repeated successes/failures not abstracted into heuristics | High |

---

### Maturity Scores

| Dimension | Status | Evidence |
|-----------|--------|----------|
| **Working Memory** | 🟢 Green | Full anchor system with drift detection, correction, subplan tracking, persistence |
| **Context Compaction** | 🟢 Green | Enriched artifact extraction, layered injection, preservation rules, checkpoint persistence |
| **Hippocampal Replay** | 🟡 Amber | Strategy/route recording exists but no scheduled replay or consolidation |
| **Sleep/Offline Processing** | 🟡 Amber | Background daemons exist but for monitoring, not cognitive processing |
| **Attention Mechanisms** | 🟡 Amber | Basic prioritization exists but no dynamic weighting or salience detection |

**Overall Score:** 🟡 **Amber** — Strong foundation (working memory, compaction) but missing key brain-inspired features (replay, sleep, attention)

---

### Recommendations

#### Priority 1: Implement Hippocampal Replay (High Impact)

**Goal:** Strengthen learned strategies through scheduled offline replay.

**Implementation:**
```javascript
// New: src/core/memory-consolidator.mjs
class MemoryConsolidator {
  // Replay successful strategies during idle time
  async replayStrategies({ sessionId, limit = 10 }) {
    const successes = memoryStore.getStrategyLedger({ success: true, limit });
    for (const s of successes) {
      // Strengthen embedding weights for successful paths
      // Create summary heuristic from repeated patterns
    }
  }
  
  // Extract patterns from repeated successes/failures
  extractPatterns({ timeWindow = '7d' }) {
    // Group by goal similarity
    // Extract common successful strategies
    // Store as heuristics in memory_artifacts
  }
}
```

**Trigger:** Run every 24 hours or after 10 sessions.

---

#### Priority 2: Add Sleep Cycles (Medium Impact)

**Goal:** Implement rest cycles for memory consolidation and context optimization.

**Implementation:**
```javascript
// New: src/core/sleep-cycle.mjs
class SleepCycle {
  constructor({ idleThresholdMs = 3600000 }) { // 1 hour idle
    this.idleThreshold = idleThresholdMs;
  }
  
  async enterSleepMode({ sessionId }) {
    // 1. Consolidate memories (replay successful paths)
    await consolidator.replayStrategies({ sessionId });
    
    // 2. Optimize context (rebuild indexes, prune stale)
    await this.consolidateMemories(sessionId);
    
    // 3. Compact aggressively (target 30% instead of 40%)
    await this.aggressiveCompaction(sessionId);
    
    // 4. Mark session as "resting"
    memoryStore.updateSessionState(sessionId, 'sleeping');
  }
  
  async wakeFromSleep({ sessionId }) {
    // Load consolidated heuristics
    // Restore working memory anchor
    // Resume from last subplan
  }
}
```

**Trigger:** After 1 hour of user idle time or session length > 50 turns.

---

#### Priority 3: Dynamic Attention Mechanism (Medium Impact)

**Goal:** Implement salience-based attention weighting.

**Implementation:**
```javascript
// New: src/core/attention.mjs
class AttentionMechanism {
  constructor() {
    this.salienceWeights = new Map(); // topic → weight
    this.decayRate = 0.95; // Per turn decay
  }
  
  // Boost attention for important events
  markSalient({ topic, weight = 1.5, reason }) {
    this.salienceWeights.set(topic, {
      weight,
      reason,
      createdAt: Date.now()
    });
  }
  
  // Apply decay to all weights
  applyDecay() {
    for (const [topic, data] of this.salienceWeights) {
      data.weight *= this.decayRate;
      if (data.weight < 0.3) this.salienceWeights.delete(topic);
    }
  }
  
  // Get attention-weighted context
  buildAttentiveContext({ baseContext, currentGoal }) {
    const goalWords = extractKeywords(currentGoal);
    const boosted = baseContext.map(item => {
      const topicMatch = goalWords.find(w => item.text.includes(w));
      const salience = topicMatch ? (this.salienceWeights.get(topicMatch)?.weight || 1) : 1;
      return { ...item, priority: salience };
    });
    return boosted.sort((a, b) => b.priority - a.priority);
  }
}
```

**Integration:** Call `markSalient()` on errors, user corrections, task milestones.

---

#### Priority 4: Memory Decay & Pruning (Low Impact)

**Goal:** Reduce retrieval noise by decaying unused memories.

**Implementation:**
```javascript
// Extend: src/memory/store.mjs
class MemoryStore {
  // Add decay tracking
  addMemoryArtifact({ sessionId, artifactType, content, sourceRef, importance = 1.0 }) {
    // Store with importance weight and lastAccessed timestamp
  }
  
  // Decay unused memories
  applyMemoryDecay({ olderThanDays = 7, decayFactor = 0.8 }) {
    const cutoff = Date.now() - (olderThanDays * 86400000);
    // Reduce importance for memories not accessed since cutoff
  }
  
  // Prune low-importance memories
  pruneMemories({ threshold = 0.2 }) {
    // Archive or delete memories with importance < threshold
  }
}
```

---

#### Priority 5: Pattern Extraction Engine (High Impact)

**Goal:** Abstract heuristics from repeated successes/failures.

**Implementation:**
```javascript
// New: src/core/pattern-extractor.mjs
class PatternExtractor {
  async extractHeuristics({ timeWindow = '30d' }) {
    const outcomes = memoryStore.getStrategyLedger({ limit: 500 });
    
    // Cluster by goal similarity (embeddings)
    const clusters = this.clusterByGoal(outcomes);
    
    for (const cluster of clusters) {
      const successRate = cluster.filter(o => o.success).length / cluster.length;
      
      if (successRate > 0.8 && cluster.length >= 3) {
        // Extract common strategy elements
        const heuristic = this.extractCommonPattern(cluster);
        memoryStore.addMemoryArtifact({
          artifactType: 'heuristic',
          content: heuristic,
          importance: successRate
        });
      }
    }
  }
}
```

**Trigger:** Run weekly or after 50 new strategy outcomes recorded.

---

### Summary

OpenUnum has a **strong foundation** for brain-inspired architecture:
- ✅ Working memory anchor is production-ready
- ✅ Context compaction is enriched and well-structured
- ✅ Memory persistence and retrieval functional

But **critical gaps** remain:
- ❌ No offline replay for learning consolidation
- ❌ No sleep cycles for cognitive rest
- ❌ No dynamic attention for focus management

**Recommended Next Steps:**
1. Implement `MemoryConsolidator` for hippocampal replay (Priority 1)
2. Add `SleepCycle` manager for offline processing (Priority 2)
3. Build `AttentionMechanism` for dynamic focus (Priority 3)

These three additions would elevate OpenUnum from **Amber** to **Green** maturity across all brain-inspired dimensions.

---

**Report Generated:** 2026-04-07 13:52 GMT+3  
**Evaluator:** Council Member 1 (Subagent)  
**Session:** `council-brain-architecture`
