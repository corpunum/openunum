#!/usr/bin/env bash
# OpenUnum Auto-Recovery Script
# Usage: ./auto-recover.sh [--dry-run] [--force-restart]

set -e

OPENUNUM_HOME="${OPENUNUM_HOME:-$HOME/.openunum}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${OPENUNUM_REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SERVER_URL="http://127.0.0.1:18880"
LOG_FILE="$OPENUNUM_HOME/logs/auto-recover.log"
MAX_RETRIES=3
RETRY_DELAY=5

log() {
    local msg="[$(date -Iseconds)] $1"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

check_health() {
    local response
    response=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/api/health" 2>/dev/null || echo "000")
    [ "$response" = "200" ]
}

check_server_process() {
    pgrep -f "node.*server.mjs" > /dev/null 2>&1
}

restart_server() {
    log "Restarting OpenUnum server..."
    
    # Graceful stop
    pkill -f "node.*server.mjs" 2>/dev/null || true
    sleep 2
    
    # Start new instance
    cd "$REPO_ROOT"
    nohup node src/server.mjs > "$OPENUNUM_HOME/logs/server.log" 2>&1 &
    
    # Wait for startup
    for i in $(seq 1 30); do
        if check_health; then
            log "Server restarted successfully"
            return 0
        fi
        sleep 1
    done
    
    log "ERROR: Server failed to start after 30 seconds"
    return 1
}

fix_browser_cdp() {
    log "Attempting to fix browser CDP..."
    curl -s -X POST "$SERVER_URL/api/browser/launch" | grep -q '"ok":true' && return 0
    log "Browser launch failed"
    return 1
}

run_self_heal() {
    log "Running self-heal..."
    local result
    result=$(curl -s -X POST "$SERVER_URL/api/self-heal/fix" 2>/dev/null)
    
    if echo "$result" | grep -q '"ok":true'; then
        log "Self-heal completed successfully"
        return 0
    else
        log "Self-heal reported issues: $result"
        return 1
    fi
}

backup_config() {
    local backup_dir="$OPENUNUM_HOME/backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"
    cp "$OPENUNUM_HOME/openunum.json" "$backup_dir/" 2>/dev/null || true
    log "Config backed up to $backup_dir"
}

main() {
    local dry_run=false
    local force_restart=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run) dry_run=true; shift ;;
            --force-restart) force_restart=true; shift ;;
            *) shift ;;
        esac
    done
    
    log "=== OpenUnum Auto-Recovery Started ==="
    
    # Step 1: Check if server is running
    if ! check_server_process; then
        log "Server process not found"
        if [ "$dry_run" = false ]; then
            backup_config
            restart_server || exit 1
        else
            log "[DRY-RUN] Would restart server"
        fi
    fi
    
    # Step 2: Check health endpoint
    if ! check_health; then
        log "Health check failed"
        if [ "$dry_run" = false ]; then
            if [ "$force_restart" = true ]; then
                backup_config
                restart_server || exit 1
            else
                log "Try --force-restart to force server restart"
                exit 1
            fi
        else
            log "[DRY-RUN] Would restart server due to health check failure"
        fi
    fi
    
    # Step 3: Run self-heal
    if [ "$dry_run" = false ]; then
        run_self_heal || true
    else
        log "[DRY-RUN] Would run self-heal"
    fi
    
    # Step 4: Check browser
    local browser_status
    browser_status=$(curl -s "$SERVER_URL/api/browser/status" 2>/dev/null)
    if ! echo "$browser_status" | grep -q '"ok":true'; then
        log "Browser CDP unhealthy"
        if [ "$dry_run" = false ]; then
            fix_browser_cdp || true
        else
            log "[DRY-RUN] Would fix browser CDP"
        fi
    fi
    
    log "=== Auto-Recovery Completed ==="
}

main "$@"
