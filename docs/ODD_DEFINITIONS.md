# ODD (Operational Design Domain) Definitions

This document defines the ODD boundaries for each execution tier in the OpenUnum system.

## Overview

ODD (Operational Design Domain) defines the operational boundaries within which an AI agent can operate safely. Each execution tier has specific constraints on:

- **Maximum confidence required** for mutating tools
- **Allowed tools** within the tier
- **Blocked tools** that require escalation to a higher tier
- **Human approval requirements**

## Execution Tiers

### Compact Tier

**Use Case:** Lightweight tasks, quick lookups, minimal risk operations.

| Parameter | Value |
|-----------|-------|
| `maxConfidenceRequired` | 0.7 |
| `requireHumanApproval` | true |

**Allowed Tools:**
- `file_read` - Read files from the filesystem
- `http_request` - Make HTTP requests
- `browser_snapshot` - Take browser snapshots
- `skill_list` - List available skills
- `email_status` - Check email status
- `research_list_recent` - List recent research items

**Blocked Tools:**
- `file_write` - Writing/creating files
- `shell_run` - Running shell commands
- `file_patch` - Patching/modifying files
- `desktop_open` - Opening desktop applications
- `desktop_xdotool` - Desktop automation

**ODD Enforcement:**
- If confidence < 0.7 and tool is mutating → **BLOCKED**
- Any blocked tool attempt → **BLOCKED** regardless of confidence
- All operations require human approval before execution

---

### Balanced Tier

**Use Case:** Standard operations, moderate risk tasks, typical workflow automation.

| Parameter | Value |
|-----------|-------|
| `maxConfidenceRequired` | 0.5 |
| `requireHumanApproval` | false |

**Allowed Tools:**
- `file_read` - Read files from the filesystem
- `file_write` - Write/create files
- `file_patch` - Patch/modify files
- `http_request` - Make HTTP requests
- `browser_snapshot` - Take browser snapshots
- `browser_extract` - Extract data from browser
- `shell_run` - Run shell commands

**Blocked Tools:**
- `desktop_open` - Opening desktop applications
- `desktop_xdotool` - Desktop automation

**ODD Enforcement:**
- If confidence < 0.5 and tool is mutating → **BLOCKED**
- Desktop automation tools → **BLOCKED** regardless of confidence
- Human approval NOT required (automated execution allowed)

---

### Full Tier

**Use Case:** Complex tasks, high-risk operations, full system access.

| Parameter | Value |
|-----------|-------|
| `maxConfidenceRequired` | 0.3 |
| `requireHumanApproval` | false |

**Allowed Tools:**
- `all` - All tools are allowed

**Blocked Tools:**
- (none)

**ODD Enforcement:**
- If confidence < 0.3 and tool is mutating → **BLOCKED**
- All tools are allowed at this tier
- Human approval NOT required (full automation)

---

## Confidence Thresholds Summary

| Tier | Mutating Tool Threshold | Shell Run Threshold | Human Approval |
|------|------------------------|---------------------|----------------|
| Compact | 0.7 | N/A (blocked) | Required |
| Balanced | 0.5 | 0.5 | Not Required |
| Full | 0.3 | 0.5 | Not Required |

## Mutating Tools List

The following tools are considered "mutating" (can modify state):

- `file_write`
- `file_patch`
- `file_restore_last`
- `shell_run`
- `desktop_open`
- `desktop_xdotool`
- `skill_install`
- `skill_approve`
- `skill_execute`
- `skill_uninstall`
- `email_send`
- `gworkspace_call`
- `research_approve`

## Integration with Confidence Scoring

The ODD system works in conjunction with the Confidence Scorer:

1. **Confidence Score** is computed by `confidence-scorer.mjs` based on evidence
2. **ODD Check** validates the tool against tier constraints
3. **Action Gating** (`gateAction`) provides additional safety checks

### Confidence-Based Action Gating Rules

1. If `confidence < 0.3` AND tool is mutating → **BLOCKED**, requires approval
2. If `confidence < 0.5` AND tool is `shell_run` → **BLOCKED**, requires approval
3. Otherwise → **ALLOWED**

## Approval Workflow

When an action is blocked:

1. System creates an approval request via `POST /api/approvals/request`
2. Request is stored with status `pending`
3. Human reviewer can:
   - **Approve** via `POST /api/approvals/:id/approve`
   - **Deny** via `POST /api/approvals/:id/deny`
4. Approved requests can proceed; denied requests are blocked

## Example Usage

```javascript
import { checkODD } from './execution-policy-engine.mjs';
import { gateAction } from './confidence-scorer.mjs';

// Check ODD for shell_run in compact tier
const oddResult = checkODD('shell_run', 0.8, 'compact');
// Result: { allowed: false, reason: 'blocked_by_odd' }

// Check ODD for file_read in compact tier
const oddResult2 = checkODD('file_read', 0.8, 'compact');
// Result: { allowed: true }

// Gate a mutating action with low confidence
const gateResult = gateAction('file_write', 0.2, 'full');
// Result: { blocked: true, reason: 'low_confidence_mutating', requiresApproval: true }
```

## Configuration

ODD settings are defined in `src/config.mjs` under `modelExecutionProfiles`:

```javascript
modelExecutionProfiles: {
  compact: {
    // ... other settings
    odd: {
      maxConfidenceRequired: 0.7,
      allowedTools: ['file_read', 'http_request', ...],
      blockedTools: ['file_write', 'shell_run', ...],
      requireHumanApproval: true
    }
  },
  // ... balanced, full tiers
}
```
