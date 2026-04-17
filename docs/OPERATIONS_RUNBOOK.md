# Operations Runbook

**Last Updated:** 2026-04-17

Use this once per shell:

```bash
export OPENUNUM_REPO_ROOT="${OPENUNUM_REPO_ROOT:-$HOME/openunum}"
cd "$OPENUNUM_REPO_ROOT"
```

## 1. Start / Stop

### Foreground start
```bash
cd "$OPENUNUM_REPO_ROOT"
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
cd "$OPENUNUM_REPO_ROOT"
pnpm deploy:gate
```

This runs:
- Unit tests (`pnpm test:unit`) — < 30 seconds
- E2E tests (`pnpm test:e2e`) — 2-5 minutes
- Smoke tests (`pnpm test:smoke`) — < 30 seconds

### Individual Test Suites
```bash
# Unit tests only
pnpm test:unit

# E2E tests only (requires running server)
pnpm start  # in background
pnpm test:e2e

# Smoke tests only (fastest)
pnpm test:smoke

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
pnpm start

# Set environment (optional)
export OPENUNUM_API_URL=http://localhost:18880
export NODE_ENV=test
```

## 3. Regression Gate

```bash
cd "$OPENUNUM_REPO_ROOT"
pnpm e2e
```

Always run before/after major changes.

## 4. OAuth-Safe UI Smoke Gate

Use this for routine frontend/backend wiring checks without launching GitHub/Google OAuth approval windows:

```bash
cd "$OPENUNUM_REPO_ROOT"
pnpm smoke:ui:noauth
```

This flow intentionally avoids:
- `POST /api/service/connect`
- `POST /api/auth/job/input`

## 5. Systemd User Service

Install:
```bash
cd "$OPENUNUM_REPO_ROOT"
bash scripts/install-systemd.sh
# installs and enables:
# - openunum.service
# - openunum-autonomy-cycle.timer
```

Manual controls:
```bash
systemctl --user status openunum.service
systemctl --user restart openunum.service
journalctl --user -u openunum.service -n 200 --no-pager
```

Crash-loop triage (`EADDRINUSE` / port conflicts):
```bash
ss -ltnp | rg 18880
journalctl --user -u openunum.service --since "15 min ago" --no-pager | rg -n "EADDRINUSE|listen|Failed|restart"
systemctl --user reset-failed openunum.service
```

Notes:
- The shipped unit file is restart-rate-limited to avoid infinite restart storms on repeated failures.
- Do not run another long-lived server on `127.0.0.1:18880` while `openunum.service` is enabled.
- If the desktop session resets unexpectedly, check for AMD GPU reset loops caused by Ollama GPU offload:
  - `journalctl -k -b --since "30 min ago" | rg -n "amdgpu|GPU reset|MES failed|device wedged|failed to halt cp gfx"`
  - `journalctl -b --since "30 min ago" | rg -n "GNOME Shell crashed|Connection reset by peer|Broken pipe|ollama\\["`
  - OpenUnum now forces CPU mode (`num_gpu=0`) for `ollama-local/*` requests.
- If the machine powers off around a stability incident window, confirm whether shutdown was manually triggered:
  - `journalctl -b -1 --since "15 min before incident" --until "5 min after incident" | rg -n "Power key pressed short|The system will power off now|System is powering down"`
  - A burst of `Power key pressed short` means logind initiated shutdown, even if `amdgpu` errors were present before it.
- Browser/CDP recovery paths now prefer non-snap Chromium binaries and launch with GPU-minimizing flags (`--disable-gpu`, `--disable-software-rasterizer`, `--disable-features=Vulkan,UseSkiaRenderer`, `--use-gl=swiftshader`).

## 6. Deployment Gate Instructions

**Before deploying any changes:**

1. **Run full test suite:**
   ```bash
   pnpm deploy:gate
   # Wait for: ✅ Deployment gate passed
   ```

2. **Verify critical endpoints:**
   ```bash
   curl -sS http://127.0.0.1:18880/api/health
   curl -sS http://127.0.0.1:18880/api/config
curl -sS http://127.0.0.1:18880/api/audit/stats
curl -sS http://127.0.0.1:18880/api/audit/diagnostics
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
   pnpm test:smoke
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
  pnpm test:e2e
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
curl -sS -X POST http://127.0.0.1:18880/api/browser/ensure -H 'Content-Type: application/json' -d '{}'
```

## 10. Phase 0 Diagnostics Triage

Use this when runtime behavior drifts or compact-profile changes are deployed.

### CLI Triage Sequence
```bash
cd "$OPENUNUM_REPO_ROOT"
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
- Audit log: `~/.openunum/audit/audit-log.jsonl`
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
- Use `/api/browser/ensure` and re-check `/api/browser/status`

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
curl -sS http://127.0.0.1:18880/api/audit/verify

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

### Symptom: "No response generated." on every query with cloud model
- Check behavior registry: `sqlite3 ~/.openunum/openunum.db "SELECT * FROM controller_behaviors;"`
- If `ollama-cloud` / `qwen3.5:397b-cloud` shows `planner_heavy_no_exec`, reset it:
  ```sql
  UPDATE controller_behaviors SET class_id = 'timeout_prone_deep_thinker', sample_count = 50,
    reasons_json = '["observed:tool_execution_success","observed:tool_execution_success","observed:tool_execution_success","observed:tool_execution_success","observed:tool_execution_success","observed:tool_execution_success","observed:tool_execution_success","observed:tool_execution_success","observed:tool_execution_success","observed:tool_execution_success"]',
    updated_at = datetime('now')
  WHERE provider = 'ollama-cloud' AND model LIKE '%qwen3.5%';
  ```
- Verify `chatHardTimeoutMs` is at least 300000 in `~/.openunum/openunum.json`
- Restart: `systemctl --user restart openunum.service`

### Symptom: Agent turns timing out with 90s hard timeout
- Check `chatHardTimeoutMs` in runtime config:
  ```bash
  cat ~/.openunum/openunum.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('runtime',{}).get('chatHardTimeoutMs','NOT SET'))"
  ```
- If missing or 90000, set to 300000 for cloud-primary deployments
