import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getHomeDir, getConfigPath, loadConfig, saveConfig } from '../config.mjs';
import { logInfo, logError, logWarn } from '../logger.mjs';
import { probeCdpEndpoint } from '../browser/cdp.mjs';

/**
 * Self-Healing System for OpenUnum
 * Monitors, detects, and automatically recovers from common failures
 */

export class SelfHealSystem {
  constructor({ config, agent, memoryStore }) {
    this.config = config;
    this.agent = agent;
    this.memoryStore = memoryStore;
    this.healthState = {
      lastCheck: null,
      status: 'unknown',
      issues: [],
      recoveryAttempts: 0,
      lastRecovery: null
    };
    this.issueHistory = [];
    this.maxIssueHistory = 100;
  }

  /**
   * Run comprehensive health check
   */
  async runHealthCheck() {
    const checks = [];
    const issues = [];

    // 1. Check server responsiveness
    checks.push({
      name: 'server_responsive',
      check: async () => {
        try {
          const res = await fetch(`http://${this.config.server.host}:${this.config.server.port}/api/health`);
          return { ok: res.ok, latency: res.ok ? 'ok' : 'failed' };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }
    });

    // 2. Check config file integrity
    checks.push({
      name: 'config_valid',
      check: async () => {
        try {
          const cfg = loadConfig();
          return { ok: true, hasModel: Boolean(cfg.model?.provider), hasRuntime: Boolean(cfg.runtime) };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }
    });

    // 3. Check database integrity
    checks.push({
      name: 'database_valid',
      check: async () => {
        try {
          const dbPath = path.join(getHomeDir(), 'openunum.db');
          if (!fs.existsSync(dbPath)) return { ok: false, error: 'database_not_found' };
          const stats = fs.statSync(dbPath);
          return { ok: stats.size > 0, sizeBytes: stats.size };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }
    });

    // 4. Check Ollama connectivity
    checks.push({
      name: 'ollama_reachable',
      check: async () => {
        try {
          const res = await fetch(`${this.config.model.ollamaBaseUrl}/api/tags`);
          return { ok: res.ok, modelsAvailable: res.ok };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }
    });

    // 5. Check browser CDP
    checks.push({
      name: 'browser_cdp',
      check: async () => {
        try {
          const out = await probeCdpEndpoint(this.config.browser.cdpUrl);
          return {
            ok: out.ok === true,
            version: out.ok ? String(out.mode || 'connected') : 'failed',
            details: out
          };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }
    });

    // 6. Check disk space
    checks.push({
      name: 'disk_space',
      check: async () => {
        try {
          const { stdout } = await this.runShell('df -h /home | tail -1');
          const parts = stdout.trim().split(/\s+/);
          const usePercent = parseInt(parts[4] || '0', 10);
          return { ok: usePercent < 90, usagePercent: usePercent };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }
    });

    // 7. Check available RAM
    checks.push({
      name: 'memory_available',
      check: async () => {
        try {
          const { stdout } = await this.runShell('free -m | grep Mem | awk \'{print $7}\'');
          const availableMB = parseInt(stdout.trim(), 10);
          return { ok: availableMB > 500, availableMB };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }
    });

    // Run all checks
    for (const check of checks) {
      try {
        const result = await check.check();
        this.healthState.lastCheck = new Date().toISOString();
        
        if (!result.ok) {
          issues.push({
            check: check.name,
            timestamp: new Date().toISOString(),
            error: result.error || 'check_failed',
            details: result
          });
        }
      } catch (error) {
        issues.push({
          check: check.name,
          timestamp: new Date().toISOString(),
          error: `check_exception: ${String(error.message || error)}`
        });
      }
    }

    this.healthState.issues = issues;
    this.healthState.status = issues.length === 0 ? 'healthy' : 'degraded';

    // Log issues
    if (issues.length > 0) {
      logWarn('health_check_issues', { count: issues.length, issues: issues.map(i => i.check) });
    }

    return {
      status: this.healthState.status,
      timestamp: this.healthState.lastCheck,
      checksPassed: checks.length - issues.length,
      checksFailed: issues.length,
      issues
    };
  }

  /**
   * Attempt automatic recovery for detected issues
   */
  async attemptRecovery(issue) {
    const recoveryStrategies = {
      ollama_reachable: async () => {
        logInfo('recovery_attempt', { issue: 'ollama_reachable', strategy: 'restart_ollama_service' });
        try {
          await this.runShell('systemctl restart ollama 2>/dev/null || pkill -f ollama; ollama serve &');
          await this.sleep(3000);
          return { ok: true, action: 'restarted_ollama' };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      },

      browser_cdp: async () => {
        logInfo('recovery_attempt', { issue: 'browser_cdp', strategy: 'launch_debug_browser' });
        try {
          const chromeBin = this.findChromeBinary();
          if (!chromeBin) return { ok: false, error: 'no_chrome_found' };
          
          await this.runShell('pkill -f "openunum-chrome-debug" 2>/dev/null || true');
          const port = 9333;
          const args = [
            `--remote-debugging-port=${port}`,
            '--user-data-dir=/tmp/openunum-chrome-debug',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-dev-shm-usage',
            '--disable-features=Vulkan,UseSkiaRenderer',
            '--use-gl=swiftshader',
            '--new-window',
            'about:blank'
          ].join(' ');
          
          spawn(chromeBin, args.split(' '), { detached: true, stdio: 'ignore' }).unref();
          await this.sleep(3000);
          
          this.config.browser.cdpUrl = `http://127.0.0.1:${port}`;
          saveConfig(this.config);
          
          return { ok: true, action: 'launched_browser', cdpUrl: this.config.browser.cdpUrl };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      },

      config_valid: async () => {
        logInfo('recovery_attempt', { issue: 'config_valid', strategy: 'restore_default_config' });
        try {
          const backupPath = `${getConfigPath()}.backup.${Date.now()}`;
          fs.copyFileSync(getConfigPath(), backupPath);
          const defaultConfig = this.getDefaultConfig();
          saveConfig(defaultConfig);
          return { ok: true, action: 'restored_default_config', backup: backupPath };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      },

      database_valid: async () => {
        logInfo('recovery_attempt', { issue: 'database_valid', strategy: 'recreate_database' });
        try {
          const dbPath = path.join(getHomeDir(), 'openunum.db');
          const backupPath = `${dbPath}.backup.${Date.now()}`;
          fs.copyFileSync(dbPath, backupPath);
          fs.unlinkSync(dbPath);
          
          // Reinitialize by loading config (which creates DB)
          loadConfig();
          this.memoryStore?.init?.();
          
          return { ok: true, action: 'recreated_database', backup: backupPath };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      },

      disk_space: async () => {
        logInfo('recovery_attempt', { issue: 'disk_space', strategy: 'cleanup_logs' });
        try {
          const logDir = path.join(getHomeDir(), 'logs');
          let oldFiles = [];
          if (fs.existsSync(logDir)) {
            const files = fs.readdirSync(logDir);
            oldFiles = files.filter(f => {
              const stat = fs.statSync(path.join(logDir, f));
              return Date.now() - stat.mtimeMs > 7 * 24 * 60 * 60 * 1000; // 7 days
            });
            oldFiles.forEach(f => fs.unlinkSync(path.join(logDir, f)));
          }
          return { ok: true, action: 'cleaned_old_logs', count: oldFiles?.length || 0 };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      },

      memory_available: async () => {
        logInfo('recovery_attempt', { issue: 'memory_available', strategy: 'garbage_collection' });
        try {
          if (global.gc) {
            global.gc();
            return { ok: true, action: 'forced_gc' };
          }
          return { ok: true, action: 'no_gc_available', note: 'run_with_node_expose_gc' };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }
    };

    const strategy = recoveryStrategies[issue.check];
    if (!strategy) {
      return { ok: false, error: 'no_recovery_strategy', check: issue.check };
    }

    try {
      const result = await strategy();
      this.healthState.recoveryAttempts += 1;
      this.healthState.lastRecovery = new Date().toISOString();
      
      this.recordIssueHistory({
        issue: issue.check,
        recoveryAttempted: true,
        recoverySuccess: result.ok,
        timestamp: new Date().toISOString()
      });

      if (result.ok) {
        logInfo('recovery_success', { issue: issue.check, action: result.action });
      } else {
        logError('recovery_failed', { issue: issue.check, error: result.error });
      }

      return result;
    } catch (error) {
      logError('recovery_exception', { issue: issue.check, error: String(error.message || error) });
      return { ok: false, error: String(error.message || error) };
    }
  }

  /**
   * Run full health check with auto-recovery
   */
  async heal() {
    const health = await this.runHealthCheck();
    const recoveries = [];

    if (health.status !== 'healthy') {
      for (const issue of health.issues) {
        const recovery = await this.attemptRecovery(issue);
        recoveries.push({ issue: issue.check, recovery });
      }

      // Re-check after recovery attempts
      const postHealth = await this.runHealthCheck();
      return {
        preHealth: health,
        recoveries,
        postHealth,
        healed: postHealth.status === 'healthy'
      };
    }

    return {
      health,
      recoveries: [],
      healed: true
    };
  }

  /**
   * Get current health state
   */
  getHealthState() {
    return {
      ...this.healthState,
      issueHistory: this.issueHistory.slice(-20)
    };
  }

  /**
   * Record issue in history
   */
  recordIssueHistory(entry) {
    this.issueHistory.push(entry);
    if (this.issueHistory.length > this.maxIssueHistory) {
      this.issueHistory.shift();
    }
  }

  /**
   * Helper: Run shell command
   */
  async runShell(cmd, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', cmd], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });

      child.on('close', (code) => {
        resolve({ ok: code === 0, code, stdout, stderr });
      });

      child.on('error', reject);
    });
  }

  /**
   * Helper: Sleep
   */
  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Helper: Find Chrome binary
   */
  findChromeBinary() {
    const candidates = [
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  /**
   * Helper: Get default config
   */
  getDefaultConfig() {
    return {
      server: { host: '127.0.0.1', port: 18880 },
      browser: { cdpUrl: 'http://127.0.0.1:9222', fallbackEnabled: true },
      runtime: {
        maxToolIterations: 8,
        shellEnabled: true,
        executorRetryAttempts: 3,
        executorRetryBackoffMs: 700,
        providerRequestTimeoutMs: 120000,
        agentTurnTimeoutMs: 420000,
        autonomyMode: 'autonomy-first'
      },
      model: {
        provider: 'ollama-cloud',
        model: 'ollama-cloud/minimax-m2.7:cloud',
        providerModels: {
          'ollama-cloud': 'ollama-cloud/minimax-m2.7:cloud',
          'ollama-local': 'ollama-local/gemma4:cpu',
          openrouter: 'openrouter/openai/gpt-4o-mini',
          nvidia: 'nvidia/qwen/qwen3-coder-480b-a35b-instruct',
          xiaomimimo: 'xiaomimimo/gpt-4o-mini',
          openai: 'openai/gpt-4o-mini'
        },
        routing: {
          fallbackEnabled: true,
          fallbackProviders: ['ollama-cloud', 'nvidia', 'openrouter', 'openai'],
          forcePrimaryProvider: false
        },
        ollamaBaseUrl: 'http://127.0.0.1:11434',
        openrouterBaseUrl: 'https://openrouter.ai/api/v1',
        nvidiaBaseUrl: 'https://integrate.api.nvidia.com/v1',
        xiaomimimoBaseUrl: 'https://api.x.ai/v1',
        openaiBaseUrl: 'https://api.openai.com/v1',
        genericBaseUrl: 'https://api.openai.com/v1',
        openrouterApiKey: '',
        nvidiaApiKey: '',
        xiaomimimoApiKey: '',
        openaiApiKey: '',
        genericApiKey: ''
      },
      channels: {
        telegram: { botToken: '', enabled: false }
      }
    };
  }
}
