# Operations Runbook

**Last Updated:** 2026-04-07 (Phase 1-3 additions)

## 1. Start / Stop

### Foreground start
```bash
cd /home/corp-unum/openunum
node src/server.mjs
```

### Health check
```bash
curl -sS http://127.0.0.1:18880/api/health
```

### CLI health
```bash
node src/cli.mjs health
```

## 2. Test Running Instructions

### Full Deployment Gate
```bash
# Run all tests before deployment
cd /home/corp-unum/openunum
npm run deploy:gate
```

This runs:
- Unit tests (`npm run test:unit`) — < 30 seconds
- E2E tests (`npm run test:e2e`) — 2-5 minutes
- Smoke tests (`npm run test:smoke`) — < 30 seconds

### Individual Test Suites
```bash
# Unit tests only
npm run test:unit

# E2E tests only (requires running server)
npm start  # in background
npm run test:e2e

# Smoke tests only (fastest)
npm run test:smoke

# Specific E2E test file
node --test tests/e2e/verifier.e2e.mjs
node --test tests/e2e/audit-logging.e2e.mjs
node --test tests/e2e/freshness-decay.e2e.mjs
```

### Test Prerequisites
```bash
# Ensure dependencies installed
pnpm install

# Start server for E2E/smoke tests
npm start

# Set environment (optional)
export OPENUNUM_API_URL=http://localhost:18880
export NODE_ENV=test
```

## 3. Regression Gate

```bash
cd /home/corp-unum/openunum
pnpm e2e
```

Always run before/after major changes.

## 4. OAuth-Safe UI Smoke Gate

Use this for routine frontend/backend wiring checks without launching GitHub/Google OAuth approval windows:

```bash
cd /home/corp-unum/openunum
pnpm smoke:ui:noauth
```

This flow intentionally avoids:
- `POST /api/service/connect`
- `POST /api/auth/job/input`

## 5. Systemd User Service

Install:
```bash
cd /home/corp-unum/openunum
bash scripts/install-systemd.sh
```

Manual controls:
```bash
systemctl --user status openunum.service
systemctl --user restart openunum.service
journalctl --user -u openunum.service -n 200 --no-pager
```

## 6. Deployment Gate Instructions

**Before deploying any changes:**

1. **Run full test suite:**
   ```bash
   npm run deploy:gate
   # Wait for: ✅ Deployment gate passed
   ```

2. **Verify critical endpoints:**
   ```bash
   curl -sS http://127.0.0.1:18880/api/health
   curl -sS http://127.0.0.1:18880/api/config
   curl -sS http://127.0.0.1:18880/api/audit/stats
   curl -sS http://127.0.0.1:18880/api/verifier/stats
   ```

3. **Check Council validation status:**
   ```bash
   # Review latest council report
   cat docs/COUNCIL_CONSOLIDATED_*.md | head -100
   ```

4. **Backup state:**
   ```bash
   cp ~/.openunum/openunum.db ~/.openunum/openunum.db.backup
   cp ~/.openunum/openunum.json ~/.openunum/openunum.json.backup
   ```

5. **Deploy:**
   ```bash
   git pull origin main
   pnpm install
   systemctl --user restart openunum.service
   ```

6. **Post-deploy verification:**
   ```bash
   # Wait 10 seconds for startup
   sleep 10
   
   # Verify health
   curl -sS http://127.0.0.1:18880/api/health
   
   # Run smoke tests
   npm run test:smoke
   ```

7. **Rollback if needed:**
   ```bash
   # Restore backups
   cp ~/.openunum/openunum.db.backup ~/.openunum/openunum.db
   cp ~/.openunum/openunum.json.backup ~/.openunum/openunum.json
   
   # Restart
   systemctl --user restart openunum.service
   ```

## 7. Monitoring Checklist for Production

### Daily Checks

- [ ] **Health endpoint responds:**
  ```bash
  curl -sS http://127.0.0.1:18880/api/health
  ```

- [ ] **No critical errors in logs:**
  ```bash
  journalctl --user -u openunum.service --since "24 hours ago" | grep -i error
  ```

- [ ] **Memory freshness check:**
  ```bash
  curl -sS http://127.0.0.1:18880/api/memory/stale?threshold=0.3
  ```

- [ ] **Audit chain integrity:**
  ```bash
  curl -sS http://127.0.0.1:18880/api/audit/stats
  ```

- [ ] **Verifier status:**
  ```bash
  curl -sS http://127.0.0.1:18880/api/verifier/status
  ```

### Weekly Checks

- [ ] **Run council validation:**
  ```bash
  node scripts/council-run-all.mjs
  node scripts/council-consolidate.mjs
  ```

- [ ] **Review route lessons:**
  ```bash
  curl -sS http://127.0.0.1:18880/api/controller/behaviors?limit=80
  ```

- [ ] **Check replay consolidation:**
  ```bash
  curl -sS http://127.0.0.1:18880/api/replay/status
  ```

- [ ] **Verify provider health:**
  ```bash
  curl -sS http://127.0.0.1:18880/api/providers/health
  ```

### Monthly Checks

- [ ] **Full E2E test suite:**
  ```bash
  npm run test:e2e
  ```

- [ ] **Database integrity:**
  ```bash
  sqlite3 ~/.openunum/openunum.db "PRAGMA integrity_check;"
  ```

- [ ] **Disk space check:**
  ```bash
  df -h ~/.openunum/
  ```

- [ ] **Archive old audit logs:**
  ```bash
  # Export logs older than 30 days
  curl -sS "http://127.0.0.1:18880/api/audit/export?from=$(date -d '30 days ago' -I)" \
    > audit-export-$(date +%Y%m).json
  ```

## 8. Recommended Runtime Baseline

For high autonomy stability:
- `autonomyMode=relentless`
- `shellEnabled=true`
- strict provider routing lock when model consistency matters

## 9. Browser Automation Checklist

1. Verify config endpoint:
```bash
curl -sS http://127.0.0.1:18880/api/browser/config
```
2. Verify status endpoint:
```bash
curl -sS http://127.0.0.1:18880/api/browser/status
```
3. Launch managed debug browser:
```bash
curl -sS -X POST http://127.0.0.1:18880/api/browser/launch -H 'Content-Type: application/json' -d '{}'
```

## 10. Phase 0 Diagnostics Triage

Use this when runtime behavior drifts or compact-profile changes are deployed.

### CLI Triage Sequence
```bash
cd /home/corp-unum/openunum
pnpm phase0:check
pnpm gate:compact-profile
```

### API Triage Sequence
```bash
curl -sS "http://127.0.0.1:18880/api/runtime/state-contract?sessionId=ops-triage&phase=phase0&nextAction=triage"
curl -sS "http://127.0.0.1:18880/api/runtime/config-parity"
```

### Interpret Results
- `state-contract.validation.ok=false`:
  - contract packet invalid for current runtime; stop rollout and fix packet publisher path before deploy.
- `config-parity.severity=error`:
  - provider matrix or mapping has hard blockers; fix config before continuing.
- `config-parity.severity=warning`:
  - deployment can proceed with caution, but missing fallback/provider keys should be remediated.

### UI Triage Sequence
- Open WebUI `Operator Runtime & Tools`.
- Check `Phase 0 Diagnostics` card:
  - `State OK` must be true for packet validation.
  - parity should be `ok` or `warning` without hard errors.
- Use `Refresh Phase 0` after config/provider changes to confirm recovery.

## 10. Telegram Checklist

1. Save token via API/UI.
2. Start loop:
```bash
curl -sS -X POST http://127.0.0.1:18880/api/telegram/start -H 'Content-Type: application/json' -d '{}'
```
3. Check status:
```bash
curl -sS http://127.0.0.1:18880/api/telegram/status
```

## 11. Data / Logs

- Config: `~/.openunum/openunum.json`
- DB: `~/.openunum/openunum.db`
- Executor log: `~/.openunum/logs/executor.jsonl`
- Audit log: `~/.openunum/logs/audit.jsonl` (Phase 4)
- Replay patterns: `~/.openunum/data/replay-patterns.json` (Phase 4)

Useful DB inspection (example):
```bash
sqlite3 ~/.openunum/openunum.db '.tables'
sqlite3 ~/.openunum/openunum.db 'select tool_name, ok, created_at from tool_runs order by id desc limit 20;'
```

## 12. Troubleshooting

### Symptom: "No response generated"
- Check provider/model reachability.
- Check trace panel for tool activity.
- Verify strict routing if fallback is disabled.

### Symptom: "Keys are present but API says missing"
- Confirm secure provider state first:
```bash
curl -sS http://127.0.0.1:18880/api/providers/config
curl -sS http://127.0.0.1:18880/api/auth/catalog
```
- Do not use `GET /api/config` key fields as truth source; config output is intentionally scrubbed.
- Refresh/import local credentials:
```bash
curl -sS -X POST http://127.0.0.1:18880/api/auth/prefill-local -H 'Content-Type: application/json' -d '{}'
```
- Re-check provider flags:
```bash
curl -sS http://127.0.0.1:18880/api/providers/config
```

### Symptom: Browser claims success but no visible window
- Confirm graphical session env (`DISPLAY`, Wayland/X11)
- Use `/api/browser/launch` and re-check `/api/browser/status`

### Symptom: Task loops without completion
- Inspect mission status and tool proof counts.
- Reduce ambiguity in prompt (artifact/path required).
- Increase hard step cap if the task is large.

### Symptom: OAuth browser/terminal prompts appear during smoke testing
- Do not click provider `Connect` actions during routine smoke tests.
- Run `pnpm smoke:ui:noauth` for safe verification.
- Reserve OAuth launcher checks for explicit auth-flow validation runs.

### Symptom: Audit chain verification fails
```bash
# Check last 10 audit entries
curl -sS http://127.0.0.1:18880/api/audit/log?limit=10

# Verify chain integrity
curl -sS -X POST http://127.0.0.1:18880/api/audit/verify

# If broken, check for manual DB edits or disk corruption
```

### Symptom: Verifier rejecting valid operations
```bash
# Check verifier stats
curl -sS http://127.0.0.1:18880/api/verifier/stats

# Review recent rejections
curl -sS http://127.0.0.1:18880/api/verifier/status

# Temporarily bypass for emergency (not recommended):
# Edit config to disable verifier for low-stakes ops
```
