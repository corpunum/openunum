/**
 * Self-Healing Module for OpenUnum
 * Monitors system health and auto-recovers from failures
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { logInfo, logError } from '../logger.mjs';

export class SelfHealer {
  constructor({ config, healthCheckIntervalMs = 30000 }) {
    this.config = config;
    this.healthCheckIntervalMs = healthCheckIntervalMs;
    this.consecutiveFailures = 0;
    this.maxFailures = 3;
    this.lastHealthCheck = Date.now();
    this.healthHistory = [];
    this.autoRecoveryEnabled = true;
  }

  /**
   * Check if critical services are healthy
   */
  async checkHealth() {
    const checks = {
      timestamp: Date.now(),
      services: {},
      overall: true
    };

    // Check 1: Config file integrity
    try {
      const configPath = path.join(process.env.HOME || '/home/corp-unum', '.openunum', 'openunum.json');
      if (fs.existsSync(configPath)) {
        JSON.parse(fs.readFileSync(configPath, 'utf8'));
        checks.services.config = { ok: true, path: configPath };
      } else {
        checks.services.config = { ok: false, error: 'config_missing' };
        checks.overall = false;
      }
    } catch (error) {
      checks.services.config = { ok: false, error: String(error.message) };
      checks.overall = false;
    }

    // Check 2: API endpoint responsiveness
    try {
      const res = await fetch(`http://127.0.0.1:${this.config.server.port}/api/health`, {
        method: 'GET',
        timeout: 5000
      });
      if (res.ok) {
        checks.services.api = { ok: true, port: this.config.server.port };
      } else {
        checks.services.api = { ok: false, error: 'api_not_responding' };
        checks.overall = false;
      }
    } catch (error) {
      checks.services.api = { ok: false, error: String(error.message) };
      checks.overall = false;
    }

    // Check 3: Browser CDP endpoint
    try {
      const res = await fetch(`${this.config.browser.cdpUrl}/json/version`, {
        method: 'GET',
        timeout: 3000
      });
      if (res.ok) {
        checks.services.browser = { ok: true, url: this.config.browser.cdpUrl };
      } else {
        checks.services.browser = { ok: false, error: 'browser_cdp_not_responding' };
      }
    } catch (error) {
      checks.services.browser = { ok: false, error: String(error.message) };
    }

    // Check 4: Ollama provider
    try {
      const res = await fetch(`${this.config.model.ollamaBaseUrl}/api/tags`, {
        method: 'GET',
        timeout: 3000
      });
      if (res.ok) {
        checks.services.ollama = { ok: true, url: this.config.model.ollamaBaseUrl };
      } else {
        checks.services.ollama = { ok: false, error: 'ollama_not_responding' };
      }
    } catch (error) {
      checks.services.ollama = { ok: false, error: String(error.message) };
    }

    // Check 5: Disk space
    try {
      const { stdout } = await this.execShell('df -h /home | tail -1 | awk \'{print $5}\'');
      const usage = parseInt(stdout.replace('%', '').trim(), 10);
      checks.services.disk = {
        ok: usage < 90,
        usage: `${usage}%`,
        warning: usage > 80
      };
      if (!checks.services.disk.ok) {
        checks.overall = false;
      }
    } catch (error) {
      checks.services.disk = { ok: false, error: String(error.message) };
    }

    // Check 6: Memory availability
    try {
      const { stdout } = await this.execShell('free -m | awk \'NR==2{printf "%.0f", $7}\'');
      const freeMem = parseInt(stdout.trim(), 10);
      checks.services.memory = {
        ok: freeMem > 500,
        freeMb: freeMem,
        warning: freeMem < 1000
      };
      if (!checks.services.memory.ok) {
        checks.overall = false;
      }
    } catch (error) {
      checks.services.memory = { ok: false, error: String(error.message) };
    }

    // Record health history
    this.healthHistory.push(checks);
    if (this.healthHistory.length > 100) {
      this.healthHistory.shift();
    }

    // Track consecutive failures
    if (!checks.overall) {
      this.consecutiveFailures += 1;
    } else {
      this.consecutiveFailures = 0;
    }

    this.lastHealthCheck = Date.now();

    // Log health status
    if (checks.overall) {
      logInfo('health_check_passed', { checks: Object.keys(checks.services).length });
    } else {
      logError('health_check_failed', {
        failures: Object.entries(checks.services)
          .filter(([, v]) => !v.ok)
          .map(([k]) => k)
      });
    }

    return checks;
  }

  /**
   * Attempt automatic recovery from failures
   */
  async attemptRecovery(healthCheck) {
    if (!this.autoRecoveryEnabled) {
      return { ok: false, reason: 'auto_recovery_disabled' };
    }

    const recoveryActions = [];

    // Recovery 1: Restart browser if CDP is down
    if (healthCheck.services.browser?.ok === false) {
      try {
        logInfo('auto_recovery_browser', { action: 'launch_debug_browser' });
        const res = await fetch(`http://127.0.0.1:${this.config.server.port}/api/browser/launch`, {
          method: 'POST',
          timeout: 10000
        });
        if (res.ok) {
          recoveryActions.push({ service: 'browser', action: 'relaunched', success: true });
        } else {
          recoveryActions.push({ service: 'browser', action: 'relaunch_failed', success: false });
        }
      } catch (error) {
        recoveryActions.push({ service: 'browser', action: 'relaunch_error', error: String(error.message) });
      }
    }

    // Recovery 2: Clear stale locks if disk is full
    if (healthCheck.services.disk?.ok === false) {
      try {
        logInfo('auto_recovery_disk', { action: 'clear_temp_files' });
        await this.execShell('rm -rf /tmp/openunum-* 2>/dev/null; rm -rf /tmp/chrome-debug* 2>/dev/null; echo "cleaned"');
        recoveryActions.push({ service: 'disk', action: 'temp_files_cleared', success: true });
      } catch (error) {
        recoveryActions.push({ service: 'disk', action: 'clear_failed', error: String(error.message) });
      }
    }

    // Recovery 3: Backup and reset config if corrupted
    if (healthCheck.services.config?.ok === false) {
      try {
        logInfo('auto_recovery_config', { action: 'restore_from_backup' });
        const configPath = path.join(process.env.HOME || '/home/corp-unum', '.openunum', 'openunum.json');
        const backupPath = `${configPath}.backup`;
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, configPath);
          recoveryActions.push({ service: 'config', action: 'restored_from_backup', success: true });
        } else {
          recoveryActions.push({ service: 'config', action: 'no_backup_available', success: false });
        }
      } catch (error) {
        recoveryActions.push({ service: 'config', action: 'restore_failed', error: String(error.message) });
      }
    }

    // Recovery 4: Critical failure - trigger full restart
    if (this.consecutiveFailures >= this.maxFailures) {
      logError('critical_failure_detected', { consecutiveFailures: this.consecutiveFailures });
      recoveryActions.push({
        service: 'system',
        action: 'critical_restart_required',
        consecutiveFailures: this.consecutiveFailures
      });
    }

    return {
      ok: recoveryActions.every((a) => a.success !== false),
      actions: recoveryActions,
      consecutiveFailures: this.consecutiveFailures
    };
  }

  /**
   * Execute shell command safely
   */
  async execShell(cmd, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', cmd], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        resolve({ ok: code === 0, code, stdout, stderr });
      });

      child.on('error', reject);
    });
  }

  /**
   * Start continuous health monitoring
   */
  startMonitoring() {
    if (this.monitoringInterval) {
      return { ok: false, reason: 'already_monitoring' };
    }

    this.monitoringInterval = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        if (!health.overall) {
          await this.attemptRecovery(health);
        }
      } catch (error) {
        logError('health_monitor_error', { error: String(error.message || error) });
      }
    }, this.healthCheckIntervalMs);

    logInfo('health_monitoring_started', { intervalMs: this.healthCheckIntervalMs });
    return { ok: true, intervalMs: this.healthCheckIntervalMs };
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logInfo('health_monitoring_stopped');
      return { ok: true };
    }
    return { ok: false, reason: 'not_monitoring' };
  }

  /**
   * Get health history and statistics
   */
  getHealthReport() {
    const total = this.healthHistory.length;
    const passed = this.healthHistory.filter((h) => h.overall).length;
    const failed = total - passed;

    return {
      totalChecks: total,
      passedChecks: passed,
      failedChecks: failed,
      successRate: total > 0 ? ((passed / total) * 100).toFixed(2) : 0,
      consecutiveFailures: this.consecutiveFailures,
      lastCheck: this.lastHealthCheck,
      monitoring: Boolean(this.monitoringInterval),
      recentHistory: this.healthHistory.slice(-10)
    };
  }
}
