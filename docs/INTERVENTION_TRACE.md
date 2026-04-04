# Intervention Trace System

**Version:** 2.1.0  
**Status:** ✅ Implemented (Phase 3)

## Overview

The Intervention Trace System logs which context management interventions fire during agent execution, with timestamps and metadata. This provides visibility into why the agent took certain actions and helps debug context management behavior.

## Traced Interventions

| Type | Trigger | Description |
|------|---------|-------------|
| `drift_correction` | Working memory detects topic drift | Model response diverges from original task |
| `continuation` | Model stops without proof | Forced continuation when no tool calls but task incomplete |
| `checklist_enforcement` | Decomposed steps incomplete | Reminds model of remaining steps |
| `preventive_continuation` | Task incomplete but model claims done | Prevents premature completion claims |
| `anchor_injection` | Working memory anchor prepended | Context anchor injected as system message |

## API Endpoints

### GET `/api/sessions/:id/trace`

Returns intervention trace for a session.

**Response:**
```json
{
  "sessionId": "abc123",
  "trace": {
    "active": {
      "sessionId": "abc123",
      "message": "Test the API",
      "startedAt": "2026-04-05T00:00:00.000Z",
      "trace": { ...full execution trace... },
      "interventions": [ ... ],
      "completedAt": "2026-04-05T00:01:00.000Z"
    },
    "interventions": {
      "count": 3,
      "items": [
        {
          "id": "intervention-0",
          "type": "anchor_injection",
          "messageId": 5,
          "createdAt": "2026-04-05T00:00:10.000Z",
          "preview": "═══ WORKING MEMORY ANCHOR ═══..."
        },
        {
          "type": "drift_correction",
          "at": "2026-04-05T00:00:30.000Z",
          "confidence": 0.75,
          "forbiddenMatches": ["off-topic-term"]
        },
        {
          "type": "checklist_enforcement",
          "at": "2026-04-05T00:00:45.000Z",
          "progress": { "complete": 2, "total": 5, "percent": 40 },
          "remainingCount": 3
        }
      ]
    }
  }
}
```

### POST `/api/chat` (Response Enhancement)

Chat responses now include `_meta.interventions` when interventions fired:

```json
{
  "sessionId": "abc123",
  "reply": "Task completed...",
  "model": { ... },
  "trace": { ... },
  "_meta": {
    "interventions": {
      "count": 2,
      "items": [
        { "type": "checklist_enforcement", "at": "...", ... },
        { "type": "preventive_continuation", "at": "...", ... }
      ]
    }
  }
}
```

## Implementation Details

### Agent Side (`src/core/agent.mjs`)

```javascript
// Initialize trace array
trace.intervention_trace = [];

// Log drift correction
if (driftAnalysis.driftDetected && driftAnalysis.confidence > 0.5) {
  trace.intervention_trace.push({
    type: 'drift_correction',
    at: new Date().toISOString(),
    confidence: driftAnalysis.confidence,
    forbiddenMatches: driftAnalysis.forbiddenMatches
  });
}

// Log checklist enforcement
if (checklistProgress.total > 0 && checklistProgress.percent < 100) {
  trace.intervention_trace.push({
    type: 'checklist_enforcement',
    at: new Date().toISOString(),
    progress: checklistProgress,
    remainingCount: remaining.length
  });
}
```

### Runtime Side (`src/server/services/chat_runtime.mjs`)

```javascript
// Store trace in pending chat for retrieval
entry.trace = out.trace || null;
entry.interventions = out.trace?.interventions || [];
```

### API Side (`src/server/routes/sessions.mjs`)

```javascript
// Extract interventions from system messages
const interventions = messages
  .filter(m => m.role === 'system' && (
    m.content.includes('DRIFT DETECTION') ||
    m.content.includes('CONTINUATION INSTRUCTION') ||
    m.content.includes('WORKING MEMORY ANCHOR') ||
    m.content.includes('Preventive continuation') ||
    m.content.includes('completion checklist')
  ))
  .map((m, idx) => ({ ... }));
```

## Use Cases

1. **Debugging**: Understand why agent took unexpected turns
2. **Optimization**: Identify which interventions fire most often
3. **Transparency**: Show users what guardrails are active
4. **Tuning**: Adjust intervention thresholds based on trace data

## Future Enhancements

- [ ] Add intervention effectiveness scoring
- [ ] Store traces in database for historical analysis
- [ ] Add filtering/querying by intervention type
- [ ] Export traces for offline analysis
