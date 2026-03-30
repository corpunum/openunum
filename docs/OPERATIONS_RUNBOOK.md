# Operations Runbook

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

## 2. Regression Gate

```bash
cd /home/corp-unum/openunum
pnpm e2e
```

Always run before/after major changes.

## 3. Systemd User Service

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

## 4. Recommended Runtime Baseline

For high autonomy stability:
- `autonomyMode=relentless`
- `shellEnabled=true`
- strict provider routing lock when model consistency matters

## 5. Browser Automation Checklist

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

## 6. Telegram Checklist

1. Save token via API/UI.
2. Start loop:
```bash
curl -sS -X POST http://127.0.0.1:18880/api/telegram/start -H 'Content-Type: application/json' -d '{}'
```
3. Check status:
```bash
curl -sS http://127.0.0.1:18880/api/telegram/status
```

## 7. Data / Logs

- Config: `~/.openunum/openunum.json`
- DB: `~/.openunum/openunum.db`
- Executor log: `~/.openunum/logs/executor.jsonl`

Useful DB inspection (example):
```bash
sqlite3 ~/.openunum/openunum.db '.tables'
sqlite3 ~/.openunum/openunum.db 'select tool_name, ok, created_at from tool_runs order by id desc limit 20;'
```

## 8. Troubleshooting

### Symptom: "No response generated"
- Check provider/model reachability.
- Check trace panel for tool activity.
- Verify strict routing if fallback is disabled.

### Symptom: Browser claims success but no visible window
- Confirm graphical session env (`DISPLAY`, Wayland/X11)
- Use `/api/browser/launch` and re-check `/api/browser/status`

### Symptom: Task loops without completion
- Inspect mission status and tool proof counts.
- Reduce ambiguity in prompt (artifact/path required).
- Increase hard step cap if the task is large.
