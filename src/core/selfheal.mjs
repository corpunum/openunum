import { loadConfig, saveConfig, defaultConfig } from '../config.mjs';
import { logInfo, logError, logWarn } from '../logger.mjs';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function readDiskUsage(homeDir) {
  try {
    const out = await execFileAsync('df', ['-h', homeDir], { encoding: 'utf8' });
    return out.stdout;
  } catch {
    const out = await execFileAsync('df', ['-h', '/'], { encoding: 'utf8' });
    return out.stdout;
  }
}

export class SelfHealMonitor {
  constructor({ config, agent, browser, memory }) {
    this.config = config;
    this.agent = agent;
    this.browser = browser;
    this.memory = memory;
    this.lastCheck = null;
    this.consecutiveFailures = 0;
    this.maxConsecutiveFailures = 3;
    this.autoHealEnabled = true;
  }

  async runFullHealthCheck() {
    const checks = {};
    let allOk = true;
    const timestamp = new Date().toISOString();

    // Check 1: Config integrity
    try {
      const cfg = loadConfig();
      if (!cfg.runtime || !cfg.model || !cfg.server) {
        throw new Error('Missing required config sections');
      }
      checks.config = { ok: true, loaded: true };
    } catch (error) {
      checks.config = { ok: false, error: String(error.message || error) };
      allOk = false;
    }

    // Check 2: Disk space
    try {
      const homeDir = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
      const dfOut = await readDiskUsage(homeDir);
      const lines = dfOut.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const usePercent = parseInt(parts[4] || '0', 10);
        checks.disk = { 
          ok: usePercent < 90, 
          usedPercent: usePercent, 
          available: parts[3],
          critical: usePercent >= 95
        };
        if (usePercent >= 90) allOk = false;
      }
    } catch (error) {
      checks.disk = { ok: true, note: 'could not check disk', error: String(error.message || error) };
    }

    // Check 3: Memory store
    try {
      const testId = `health-check-${Date.now()}`;
      this.memory.addMessage(testId, 'user', 'health check');
      this.memory.getMessages(testId, 1);
      checks.memory = { ok: true };
    } catch (error) {
      checks.memory = { ok: false, error: String(error.message || error) };
      allOk = false;
    }

    // Check 4: Browser CDP
    try {
      const browserStatus = await this.browser.status();
      checks.browser = { 
        ok: browserStatus.ok === true, 
        cdpUrl: this.config.browser?.cdpUrl,
        details: browserStatus 
      };
      if (!browserStatus.ok) allOk = false;
    } catch (error) {
      checks.browser = { ok: false, error: String(error.message || error), cdpUrl: this.config.browser?.cdpUrl };
      allOk = false;
    }

    // Check 5: Provider connectivity
    try {
      const testModel = this.agent.getCurrentModel();
      checks.provider = { 
        ok: true, 
        provider: testModel.provider, 
        model: testModel.model,
        activeProvider: testModel.activeProvider,
        activeModel: testModel.activeModel
      };
    } catch (error) {
      checks.provider = { ok: false, error: String(error.message || error) };
      allOk = false;
    }

    // Check 6: Server responsiveness (internal)
    checks.server = { ok: true, uptime: process.uptime(), pid: process.pid };

    // Check 7: Log file writeable
    try {
      const homeDir = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
      const testLogPath = path.join(homeDir, 'logs', `health-test-${Date.now()}.log`);
      fs.writeFileSync(testLogPath, 'health check\n', 'utf8');
      fs.unlinkSync(testLogPath);
      checks.logs = { ok: true, path: path.join(homeDir, 'logs') };
    } catch (error) {
      checks.logs = { ok: false, error: String(error.message || error) };
      allOk = false;
    }

    // Check 8: Skills directory
    try {
      const homeDir = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
      const skillsDir = path.join(homeDir, 'skills');
      if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true });
      }
      const skills = fs.readdirSync(skillsDir);
      checks.skills = { ok: true, count: skills.length, path: skillsDir };
    } catch (error) {
      checks.skills = { ok: false, error: String(error.message || error) };
      allOk = false;
    }

    this.lastCheck = { timestamp, ok: allOk, checks };
    
    // Track consecutive failures
    if (!allOk) {
      this.consecutiveFailures += 1;
      logWarn('health_check_failed', { 
        consecutiveFailures: this.consecutiveFailures,
        failedChecks: Object.entries(checks).filter(([_, v]) => !v.ok).map(([k]) => k)
      });
    } else {
      this.consecutiveFailures = 0;
    }

    return this.lastCheck;
  }

  async autoHeal() {
    if (!this.autoHealEnabled) {
      return { ok: false, reason: 'auto_heal_disabled' };
    }

    const actions = [];
    const results = [];

    // Action 1: Fix config if corrupted
    if (this.lastCheck?.checks?.config?.ok === false) {
      try {
        const newCfg = defaultConfig();
        saveConfig(newCfg);
        this.config = newCfg;
        this.agent.reloadTools();
        actions.push({ action: 'rebuild_config', status: 'applied' });
        results.push({ action: 'rebuild_config', success: true });
        logInfo('selfheal_config_rebuilt', {});
      } catch (error) {
        actions.push({ action: 'rebuild_config', status: 'failed', error: String(error.message || error) });
        results.push({ action: 'rebuild_config', success: false, error: String(error.message || error) });
      }
    } else {
      results.push({ action: 'config_ok', success: true });
    }

    // Action 2: Reload agent tools if config was fixed
    if (actions.some(a => a.action.includes('config'))) {
      try {
        this.agent.reloadTools();
        actions.push({ action: 'reload_agent_tools', status: 'applied' });
        results.push({ action: 'reload_agent_tools', success: true });
      } catch (error) {
        results.push({ action: 'reload_agent_tools', success: false, error: String(error.message || error) });
      }
    }

    // Action 3: Browser CDP recovery suggestion
    if (this.lastCheck?.checks?.browser?.ok === false) {
      actions.push({ 
        action: 'browser_cdp_unhealthy', 
        status: 'needs_attention', 
        hint: 'Try POST /api/browser/launch or update CDP URL in config'
      });
      results.push({ 
        action: 'browser_cdp_unhealthy', 
        success: false, 
        hint: 'Call /api/browser/launch to start debug browser'
      });
    } else {
      results.push({ action: 'browser_ok', success: true });
    }

    // Action 4: Disk space warning
    if (this.lastCheck?.checks?.disk?.critical === true) {
      actions.push({ 
        action: 'disk_space_critical', 
        usedPercent: this.lastCheck.checks.disk.usedPercent,
        status: 'critical',
        hint: 'Free up disk space immediately'
      });
      results.push({ 
        action: 'disk_space_critical', 
        success: false, 
        hint: 'Remove old logs, clear cache, or expand disk'
      });
      logWarn('disk_space_critical', { usedPercent: this.lastCheck.checks.disk.usedPercent });
    } else if (this.lastCheck?.checks?.disk?.ok === false) {
      actions.push({ 
        action: 'disk_space_warning', 
        usedPercent: this.lastCheck.checks.disk.usedPercent,
        status: 'warning'
      });
      results.push({ action: 'disk_space_warning', success: false });
    } else {
      results.push({ action: 'disk_space_ok', usedPercent: this.lastCheck?.checks?.disk?.usedPercent || 0, success: true });
    }

    // Action 5: Check consecutive failures threshold
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      actions.push({ 
        action: 'consecutive_failures_threshold', 
        count: this.consecutiveFailures,
        status: 'critical',
        hint: 'Multiple health checks failed - consider manual intervention'
      });
      results.push({ 
        action: 'consecutive_failures_threshold', 
        success: false, 
        hint: 'Review logs and consider restarting server'
      });
      logError('consecutive_health_failures', { count: this.consecutiveFailures });
    }

    const overallOk = results.every(r => r.success !== false);
    
    if (overallOk && actions.length > 0) {
      logInfo('selfheal_completed', { actions: actions.length, results: results.length });
    }

    return { 
      ok: overallOk, 
      actions, 
      results,
      consecutiveFailures: this.consecutiveFailures,
      timestamp: new Date().toISOString()
    };
  }

  getStatus() {
    return {
      autoHealEnabled: this.autoHealEnabled,
      consecutiveFailures: this.consecutiveFailures,
      maxConsecutiveFailures: this.maxConsecutiveFailures,
      lastCheck: this.lastCheck,
      uptime: process.uptime(),
      pid: process.pid
    };
  }

  enable() {
    this.autoHealEnabled = true;
    logInfo('selfheal_enabled', {});
  }

  disable() {
    this.autoHealEnabled = false;
    logInfo('selfheal_disabled', {});
  }
}
