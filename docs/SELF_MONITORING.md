# Self-Monitoring System

## Overview

The self-monitoring system automatically tracks agent progress and continues execution without requiring user prompts. This prevents the agent from getting stuck in incomplete states and ensures continuous autonomous operation.

## Components

### 1. Self Monitor (`src/core/self-monitor.mjs`)

Main monitoring system that:
- Tracks session progress
- Determines when to automatically continue execution
- Generates continuation prompts based on current state
- Prevents premature completion claims

### 2. Task Tracker (`src/core/task-tracker.mjs`)

Tracks planned vs. completed work:
- Monitors individual task steps
- Maintains progress statistics
- Persists task state to memory store
- Verifies completion criteria

### 3. Enhanced Execution Contract (`src/core/execution-contract.mjs`)

Improved completion validation:
- Uses proof scoring for better validation
- Requires evidence-backed completion claims
- Implements confidence-based decision making
- Prevents false completion declarations

## How It Works

### Automatic Continuation

The self-monitor continuously evaluates:
- Current proof confidence scores
- Tool execution results
- Task completion progress
- Mission status

When insufficient progress is detected, the system automatically generates continuation prompts to keep execution moving forward.

### Proof-Based Completion

Instead of relying on simple keyword matching, the enhanced execution contract uses:
- Multi-dimensional proof scoring (tool success, output relevance, goal alignment, error absence)
- Confidence thresholds for completion validation
- Evidence-based decision making

### Task Progress Tracking

The task tracker maintains:
- Detailed step-by-step progress
- Completion timestamps
- Result validation
- Progress percentages

## Configuration

The system can be tuned through:
- Confidence thresholds in proof scoring
- Maximum check counts for monitoring
- Continuation prompt generation rules
- Memory persistence settings

## Benefits

1. **Reduced User Intervention**: Agent continues working without manual prompts
2. **Better Completion Validation**: Evidence-based completion decisions
3. **Progress Transparency**: Clear tracking of what's been done vs. what remains
4. **Reliability**: Prevention of premature completion claims
5. **Autonomy**: True hands-off operation for extended tasks

## Integration Points

- Agent core (`src/core/agent.mjs`)
- Mission runner (`src/core/missions.mjs`)
- Task orchestrator (`src/core/task-orchestrator.mjs`)
- Memory store (`src/memory/store.mjs`)
