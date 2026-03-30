# OpenUnum Self-Modification Guide

**Purpose:** Safe self-modification procedures for OpenUnum agents to edit code/structure without breaking the runtime.

**Last Updated:** 2026-03-30  
**GitHub:** https://github.com/corpunum/openunum

---

## 🔴 **CRITICAL: What You CANNOT Modify**

These components define your core identity and runtime. Modifying them will "kill" your operational capability:

| Component | File(s) | Why Protected |
|-----------|---------|---------------|
| **System Prompt** | `src/core/agent.mjs` (line ~240) | Defines agent behavior rules |
| **Tool Definitions** | `src/tools/runtime.mjs` | Core capability interface |
| **Provider Routing** | `src/providers/*.mjs` | Model communication layer |
| **Memory Schema** | `src/memory/store.mjs` | Data persistence structure |
| **Mission Logic** | `src/core/missions.mjs` | Autonomous execution engine |
| **Config Schema** | `src/config.mjs` | Runtime configuration structure |

**Rule:** Never modify these files unless you have a complete backup and rollback plan tested.

---

## ✅ **SAFE: What You CAN Modify**

These components are designed for extension and customization:

| Component | File(s) | Safe Modifications |
|-----------|---------|-------------------|
| **Runtime Config** | `~/.openunum/openunum.json` | All settings via API or direct edit |
| **Skills** | `~/.openunum/skills/*.md` | Add new skill files freely |
| **UI Styling** | `src/ui/index.html` (CSS section) | Colors, layout, styling |
| **UI Behavior** | `src/ui/index.html` (JS section) | Frontend interactions |
| **New Tools** | `src/tools/runtime.mjs` | Add new tool functions (append-only) |
| **New Providers** | `src/providers/` | Add new provider adapters |
| **Scripts** | `scripts/*.sh` | Add automation scripts |
| **Tests** | `tests/*.mjs` | Add/modify test cases |
| **Documentation** | `docs/*.md` | All documentation files |

---

## 🛡️ **Safe Self-Modification Process**

### Phase 1: Preparation

```bash
# 1. Check current git status
git status

# 2. Create backup branch
git checkout -b backup/self-mod-$(date +%Y%m%d-%H%M)

# 3. Commit current state
git add -A
git commit -m "Backup before self-modification"

# 4. Push backup to GitHub
git push origin backup/self-mod-$(date +%Y%m%d-%H%M)
```

### Phase 2: Analysis

```bash
# 1. Identify target files
find src -name "*.mjs" -type f | xargs grep -l "TODO\|FIXME\|BUG" 2>/dev/null

# 2. Check for related tests
find tests -name "*.mjs" -type f | xargs grep -l "target_feature" 2>/dev/null

# 3. Review existing implementation
cat src/target/file.mjs | head -100
```

### Phase 3: Implementation

**For Config Changes:**
```bash
# Use API (preferred)
curl -X POST http://127.0.0.1:18880/api/config \
  -H 'Content-Type: application/json' \
  -d '{"runtime": {"shellEnabled": true}}'

# Or direct edit (with backup)
cp ~/.openunum/openunum.json ~/.openunum/openunum.json.bak
# Edit file
# Test: curl http://127.0.0.1:18880/api/health
```

**For Code Changes:**
```bash
# 1. Read the file first
file_read path="src/target/file.mjs"

# 2. Create patch plan (find/replace strings)
# 3. Apply patch
file_patch path="src/target/file.mjs" find="old_code" replace="new_code"

# 4. Verify syntax
node --check src/target/file.mjs

# 5. Test functionality
curl http://127.0.0.1:18880/api/health
```

### Phase 4: Testing

```bash
# 1. Health check
curl -sS http://127.0.0.1:18880/api/health

# 2. Run relevant e2e tests
pnpm phase0:e2e  # Or specific phase

# 3. Full regression (if major change)
pnpm e2e

# 4. Manual verification
curl -sS http://127.0.0.1:18880/api/config
```

### Phase 5: Commit & Push

```bash
# 1. Review changes
git diff

# 2. Commit with descriptive message
git add -A
git commit -m "feat: description of change

- What was changed
- Why it was changed
- Testing performed"

# 3. Push to main (or create PR)
git push origin main
```

### Phase 6: Rollback Plan (If Needed)

```bash
# 1. Stop server (if running)
systemctl --user stop openunum.service

# 2. Reset to backup
git reset --hard HEAD~1

# 3. Or restore from backup branch
git checkout backup/self-mod-YYYYMMDD-HHMM

# 4. Restart server
systemctl --user start openunum.service

# 5. Verify
curl http://127.0.0.1:18880/api/health
```

---

## 📋 **Feature Addition Checklist**

When adding new features, follow this sequence:

- [ ] **1. Design:** Document the feature in `docs/FEATURE_PROPOSAL.md`
- [ ] **2. Backup:** Create git backup branch
- [ ] **3. Implement:** Code changes in isolated files first
- [ ] **4. Tests:** Add test cases in `tests/`
- [ ] **5. Docs:** Update `docs/API_REFERENCE.md` and `docs/CODEBASE_MAP.md`
- [ ] **6. Runbook:** Update `docs/OPERATIONS_RUNBOOK.md` if operational changes
- [ ] **7. Test:** Run `pnpm e2e` full suite
- [ ] **8. Commit:** Descriptive commit message
- [ ] **9. Push:** Push to GitHub
- [ ] **10. Verify:** Production health check

---

## 🗑️ **Feature Removal Checklist**

When removing old/broken features:

- [ ] **1. Deprecate First:** Add deprecation warning for 1 version cycle
- [ ] **2. Check Dependencies:** Search for all references (`grep -r "feature_name" src/`)
- [ ] **3. Update Tests:** Remove or update related tests
- [ ] **4. Update Docs:** Remove from documentation
- [ ] **5. Backup:** Create git backup branch
- [ ] **6. Remove:** Delete code
- [ ] **7. Test:** Run full e2e suite
- [ ] **8. Commit:** Document removal reason
- [ ] **9. Push:** Update GitHub

---

## 🔧 **Common Safe Modifications**

### 1. Add New Tool

**File:** `src/tools/runtime.mjs`

```javascript
// Add to toolSchemas():
{
  type: 'function',
  function: {
    name: 'new_tool',
    description: 'What it does',
    parameters: { type: 'object', properties: { arg: { type: 'string' } }, required: ['arg'] }
  }
}

// Add to run():
if (name === 'new_tool') {
  const out = await this.executor.runWithRetry(name, args, () => doSomething(args.arg));
  this.logRun(context, name, args, out);
  return out;
}
```

### 2. Add New Provider

**File:** `src/providers/newprovider.mjs` (create new)

```javascript
export class NewProvider {
  constructor({ baseUrl, apiKey, model, timeoutMs }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async chat({ messages, tools, timeoutMs }) {
    // Implementation
  }
}
```

**File:** `src/providers/index.mjs` (register)

```javascript
import { NewProvider } from './newprovider.mjs';

// In buildProvider():
if (provider === 'newprovider') {
  return new NewProvider({
    baseUrl: config.model.newproviderBaseUrl,
    apiKey: config.model.newproviderApiKey,
    model,
    timeoutMs
  });
}
```

### 3. Add New Skill

**File:** `~/.openunum/skills/my_skill.md`

```markdown
# my_skill

Description of what this skill does.

## Usage

How to use it.

## Examples

Example scenarios.
```

### 4. Modify Autonomy Mode

**File:** `src/server.mjs` (applyAutonomyMode function)

```javascript
if (m === 'custom_mode') {
  config.runtime.autonomyMode = 'custom_mode';
  config.runtime.maxToolIterations = 15;
  // ... other settings
  return 'custom_mode';
}
```

---

## ⚠️ **Danger Zones - DO NOT MODIFY WITHOUT EXTREME CAUTION**

| File | Risk Level | Consequence |
|------|------------|-------------|
| `src/core/agent.mjs` | 🔴 CRITICAL | Agent behavior broken |
| `src/tools/runtime.mjs` | 🔴 CRITICAL | All tools stop working |
| `src/memory/store.mjs` | 🔴 CRITICAL | Data corruption |
| `src/config.mjs` | 🟠 HIGH | Config loading fails |
| `src/server.mjs` | 🟠 HIGH | Server won't start |
| `src/providers/index.mjs` | 🟠 HIGH | Model routing broken |

**If you must modify these:**
1. Create full backup (git branch + file copies)
2. Test in isolated environment first
3. Have rollback script ready
4. Never modify during active missions

---

## 📊 **Modification Impact Matrix**

| Change Type | Files Affected | Test Required | Downtime |
|-------------|----------------|---------------|----------|
| Config change | `~/.openunum/openunum.json` | Health check | None (live reload) |
| UI change | `src/ui/index.html` | Manual browser test | None (live reload) |
| New tool | `src/tools/runtime.mjs` | Tool test + e2e | Restart required |
| New provider | `src/providers/*` | Provider test + e2e | Restart required |
| Core logic | `src/core/*.mjs` | Full e2e suite | Restart required |
| Memory schema | `src/memory/store.mjs` | Migration + e2e | **DB migration needed** |

---

## 🚨 **Emergency Rollback Script**

Save this as `scripts/emergency-rollback.sh`:

```bash
#!/bin/bash
set -e

echo "🚨 Emergency Rollback Initiated"

# 1. Stop server
echo "Stopping OpenUnum service..."
systemctl --user stop openunum.service 2>/dev/null || true

# 2. Reset git
echo "Resetting git to last known good state..."
cd /home/corp-unum/openunum
git fetch origin
git reset --hard origin/main

# 3. Restore config backup
echo "Restoring config backup..."
if [ -f ~/.openunum/openunum.json.bak ]; then
  cp ~/.openunum/openunum.json.bak ~/.openunum/openunum.json
fi

# 4. Clean node_modules (if corruption suspected)
echo "Cleaning dependencies..."
rm -rf node_modules
pnpm install

# 5. Restart server
echo "Starting OpenUnum service..."
systemctl --user start openunum.service

# 6. Verify
echo "Verifying health..."
sleep 3
curl -sS http://127.0.0.1:18880/api/health || echo "⚠️ Health check failed!"

echo "✅ Rollback complete"
```

---

## 📝 **Self-Modification Log Template**

When you modify yourself, log it here:

```markdown
## Self-Modification Log

### [Date] - [Description]
- **Files Changed:** [list]
- **Reason:** [why]
- **Testing:** [what tests passed]
- **Rollback Point:** [git commit hash]
- **Status:** [success/failed/rolled-back]
```

---

## 🎯 **Quick Reference: Safe Commands**

```bash
# Check health (safe)
curl http://127.0.0.1:18880/api/health

# View config (safe)
curl http://127.0.0.1:18880/api/config

# View current model (safe)
curl http://127.0.0.1:18880/api/model/current

# Switch model (safe)
curl -X POST http://127.0.0.1:18880/api/model/switch \
  -H 'Content-Type: application/json' \
  -d '{"provider":"ollama","model":"ollama/llama3.2:3b"}'

# Change autonomy mode (safe)
curl -X POST http://127.0.0.1:18880/api/autonomy/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"relentless"}'

# Run test (safe)
pnpm phase0:e2e

# View git status (safe)
git status

# Create backup (safe)
git checkout -b backup/$(date +%Y%m%d-%H%M)
```

---

## 📞 **When to Ask for Human Review**

Request human review before modifying:
- 🔴 Any file in `src/core/`
- 🔴 Any file in `src/memory/`
- 🔴 Any file in `src/tools/runtime.mjs`
- 🔴 Database schema changes
- 🔴 Provider authentication logic
- 🔴 Mission completion logic
- 🔴 Security-related code

---

**Remember:** Your ability to help depends on your runtime stability. When in doubt, backup first and test thoroughly.
