import { SelfHealMonitor } from './selfheal.mjs';
import { AutoRecover } from './auto-recover.mjs';
import { logInfo, logWarn } from '../logger.mjs';

function mapCheckToIssueType(checkName) {
  const map = {
    browser: 'browser_cdp_unreachable',
    provider: 'model_provider_timeout',
    disk: 'disk_space_low',
    memory: 'memory_session_lost',
    config: 'server_health_check_failed'
  };
  return map[String(checkName || '').trim().toLowerCase()] || null;
}

export class SelfHealOrchestrator {
  constructor({ config, agent, browser, memory }) {
    this.config = config;
    this.agent = agent;
    this.browser = browser;
    this.memory = memory;
    this.monitor = new SelfHealMonitor({ config, agent, browser, memory });
    this.recover = new AutoRecover({ config, agent });
  }

  async runHealthCheck() {
    const monitorHealth = await this.monitor.runFullHealthCheck();
    const issues = Object.entries(monitorHealth.checks || {})
      .filter(([, value]) => value?.ok === false)
      .map(([check, details]) => ({
        check,
        timestamp: monitorHealth.timestamp,
        error: details?.error || 'check_failed',
        details
      }));
    return {
      ...monitorHealth,
      status: monitorHealth.ok ? 'healthy' : 'degraded',
      issues,
      checksPassed: Object.keys(monitorHealth.checks || {}).length - issues.length,
      checksFailed: issues.length
    };
  }

  async runSelfHeal(dryRun = false) {
    const health = await this.runHealthCheck();
    if (dryRun) {
      return {
        ok: Boolean(health.ok),
        dryRun: true,
        status: health.status,
        checks: health.checks,
        issues: health.issues || []
      };
    }

    const base = await this.monitor.autoHeal();
    const recoveryActions = [];
    const recoveryResults = [];

    for (const issue of health.issues || []) {
      const issueType = mapCheckToIssueType(issue.check);
      if (!issueType) continue;
      try {
        const out = await this.recover.recover({
          type: issueType,
          severity: 'high',
          details: issue
        });
        recoveryActions.push({ action: `auto_recover:${issueType}`, status: out.success ? 'applied' : 'failed' });
        recoveryResults.push({ action: `auto_recover:${issueType}`, success: Boolean(out.success), details: out });
      } catch (error) {
        recoveryActions.push({ action: `auto_recover:${issueType}`, status: 'failed' });
        recoveryResults.push({ action: `auto_recover:${issueType}`, success: false, error: String(error.message || error) });
      }
    }

    const merged = {
      ...base,
      status: health.status,
      checks: health.checks,
      issues: health.issues || [],
      actions: [...(base.actions || []), ...recoveryActions],
      results: [...(base.results || []), ...recoveryResults]
    };
    merged.ok = merged.results.every((item) => item.success !== false);
    logInfo('self_heal_orchestrator_run', {
      ok: merged.ok,
      failedChecks: Object.entries(health.checks || {}).filter(([, value]) => value?.ok === false).map(([key]) => key),
      recoveries: recoveryResults.length
    });
    return merged;
  }

  getStatus({ pendingChatsCount = 0, telegramRunning = false } = {}) {
    const monitorStatus = this.monitor.getStatus();
    return {
      ...monitorStatus,
      pendingChats: pendingChatsCount,
      telegramRunning,
      model: this.agent?.getCurrentModel?.() || null,
      config: {
        autonomyMode: this.config.runtime?.autonomyMode,
        shellEnabled: this.config.runtime?.shellEnabled,
        maxToolIterations: this.config.runtime?.maxToolIterations
      }
    };
  }

  setAutoHealEnabled(enabled) {
    if (typeof this.monitor.setAutoHealEnabled === 'function') {
      this.monitor.setAutoHealEnabled(enabled);
      return;
    }
    logWarn('self_heal_set_auto_heal_not_supported', { enabled });
  }
}
