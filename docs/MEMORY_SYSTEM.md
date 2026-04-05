# OpenUnum Memory System

**Version:** 2.1.0  
**Last Updated:** 2026-04-05

---

## Overview

OpenUnum uses a **hybrid memory architecture** combining:
- **Session memory** — Chat history with compaction
- **Long-term memory** — Persisted knowledge for retrieval
- **Working memory** — Task anchor for drift prevention

---

## Memory Layers

### 1. Session Memory
**Location:** `data/sessions/*.json`  
**Purpose:** Persist chat history across refreshes  
**Retention:** Indefinite (user-managed)

Structure:
```json
{
  "id": "session_1774970079541_a3gq29",
  "title": "Hybrid Retrieval Implementation",
  "createdAt": "2026-04-05T12:00:00.000Z",
  "updatedAt": "2026-04-05T14:30:00.000Z",
  "messages": [
    { "role": "user", "content": "...", "timestamp": "..." },
    { "role": "assistant", "content": "...", "timestamp": "..." }
  ],
  "messageCount": 24
}
```

Features:
- Auto-generated titles from first message
- Selectable history in UI sidebar
- Compaction after ~12 turns
- Pending run recovery (survives refresh)

---

### 2. Long-Term Memory (Hybrid Retrieval)
**Location:** `data/memory/*.md`  
**Purpose:** Knowledge base for semantic retrieval  
**Retention:** Indefinite (curated)

#### Retrieval Pipeline

```
User Query
    ↓
BM25 Search (top-20 candidates)
    ↓
Embedding Generation (Ollama nomic-embed-text)
    ↓
Cosine Similarity Reranking
    ↓
Top-5 Results (with dual scores)
```

**Example:**
```javascript
const retriever = createHybridRetriever({ workspaceRoot: '/home/corp-unum/openunum' });

const results = await retriever.retrieve('parabolic strategy decisions', {
  useHybrid: true,
  fallbackToBM25: true
});

// Returns:
[
  {
    id: 'parabolic-strategy-decision',
    text: '...',
    metadata: { file: 'parabolic-strategy-decision.md' },
    bm25Score: 0.847,
    similarity: 0.923,
    retrievalMethod: 'hybrid'
  },
  // ... 4 more
]
```

#### Embedding Service
**Location:** `src/memory/embeddings.mjs`

- **Model:** nomic-embed-text (via Ollama)
- **Dimensions:** 768
- **Cache:** In-memory (LRU, max 1000 entries)
- **Fallback:** BM25-only if embeddings unavailable

#### BM25 Implementation
**Location:** `src/memory/recall.mjs`

Custom implementation with:
- Term frequency weighting
- Inverse document frequency
- Length normalization (simplified)

---

### 3. Working Memory (Anchor System)
**Location:** `src/core/working-memory.mjs`  
**Purpose:** Prevent context drift in weak models  
**Retention:** Per-session (cleared on reset)

Structure:
```javascript
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
    { "title": "Phase 2: BM25", "steps": ["Implement scoring", "Test retrieval"] },
    { "title": "Phase 3: Integration", "steps": ["Wire into agent", "E2E test"] }
  ],
  "currentSubplanIndex": 1,
  "createdAt": "2026-04-05T12:00:00.000Z"
}
```

**Persistence:** `data/working-memory/*.json`

---

## Memory Operations API

### Store Memory
```javascript
const memory = await memoryStore.store({
  text: 'Parabolic strategy: 30s scan frequency, real-time aggregation, volatile-only ATR filter',
  category: 'decision',
  importance: 0.8,
  tags: ['trading', 'parabolic', 'strategy']
});
```

### Recall Memory
```javascript
const results = await memoryStore.recall('parabolic strategy', {
  limit: 5,
  useHybrid: true
});
```

### Search Memory
```javascript
const results = await memoryStore.search('trading', {
  category: 'decision',
  limit: 10
});
```

### Delete Memory
```javascript
await memoryStore.forget({ query: 'outdated strategy' });
// or
await memoryStore.forget({ memoryId: 'mem_abc123' });
```

---

## Channel State Persistence

**Location:** `data/channel-state/*.json`

Stores state for external channels (Telegram, WhatsApp, etc.):
```json
{
  "telegram": {
    "offset": 12345,
    "lastPoll": "2026-04-05T14:30:00.000Z"
  }
}
```

Used by:
- Telegram bot (message offset)
- WhatsApp (session state)
- Future channels

---

## Compaction Strategy

### When to Compact
- Sessions exceed 12 turns (~4K tokens)
- Context budget exceeded for target model

### What Gets Compacted
- Turns 1 to N-4: Summarized with enriched artifacts
- Turns N-3 to N: Kept raw (sliding window)

### Enriched Artifacts
Extracted during compaction:
- `verifiedFacts` — Confirmed statements
- `openLoops` — Unanswered questions
- `pendingSubgoals` — Unfinished tasks
- `failuresWithReasons` — Categorized errors
- `producedArtifacts` — Files, code, tests, docs

**Location:** `src/core/context-compact.mjs`

---

## Memory Hygiene

### Automatic
- LRU cache for embeddings (max 1000)
- Compaction after 12 turns
- Channel state persisted after each poll

### Manual
```bash
# List memories
ls data/memory/

# Delete old sessions
rm data/sessions/session_*.json

# Clear embedding cache
# (Restart server or call contextCompiler.clearCache())
```

### Best Practices
1. **Curate long-term memories** — Don't let `data/memory/` grow unbounded
2. **Archive old sessions** — Move to `data/sessions/archive/` after 30 days
3. **Monitor embedding cache** — Check hit rate in logs

---

## Troubleshooting

### Embeddings Unavailable
```
Error: Ollama embeddings API returned 404
```
**Fix:** Pull nomic-embed-text model:
```bash
ollama pull nomic-embed-text
```

### Memory Dir Not Found
```
INFO: memory_dir_not_found { path: "/home/corp-unum/openunum/data/memory" }
```
**Fix:** Create directory:
```bash
mkdir -p data/memory
```

### High Token Usage
**Symptom:** Context exceeds model budget  
**Fix:** Reduce `maxRecentTurns` in context compiler or lower `bm25TopK` in retriever

---

## References

- `src/memory/embeddings.mjs` — Embedding service
- `src/memory/recall.mjs` — Hybrid retriever
- `src/memory/store.mjs` — Memory store
- `src/core/working-memory.mjs` — Anchor system
- `src/core/context-compact.mjs` — Compaction
