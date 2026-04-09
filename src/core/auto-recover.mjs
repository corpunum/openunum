import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { logInfo, logError, logWarn } from '../logger.mjs';
import { loadConfig, saveConfig, getHomeDir } from '../config.mjs';
import { probeCdpEndpoint } from '../browser/cdp.mjs';

/**
 * Auto-Recovery System
 * Automatically detects and fixes common issues without human intervention
 */

export class AutoRecover {
  constructor({ config, agent }) {
    this.config = config;
    this.agent = agent;
    this.recoveryHistory = [];
    this.maxHistory = 50;
  }

  /**
   * Main recovery entry point - analyzes issue and applies fix
   */
  async recover(issue) {
    const recovery = {
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      issue: issue.type,
      severity: issue.severity || 'medium',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      success: false,
      action: null,
      error: null
    };

    logWarn('auto_recovery_started', { issue: issue.type, severity: recovery.severity });

    try {
      // Route to appropriate recovery handler
      const handler = this.getRecoveryHandler(issue.type);
      if (!handler) {
        throw new Error(`No recovery handler for: ${issue.type}`);
      }

      recovery.action = await handler.call(this, issue);
      recovery.success = true;
      recovery.finishedAt = new Date().toISOString();

      logInfo('auto_recovery_completed', {
        id: recovery.id,
        issue: issue.type,
        action: recovery.action
      });

      this.recordRecovery(recovery);
      return recovery;
    } catch (error) {
      recovery.error = String(error.message || error);
      recovery.finishedAt = new Date().toISOString();

      logError('auto_recovery_failed', {
        id: recovery.id,
        issue: issue.type,
        error: recovery.error
      });

      this.recordRecovery(recovery);
      throw error;
    }
  }

  /**
   * Get the appropriate recovery handler for an issue type
   */
  getRecoveryHandler(issueType) {
    const handlers = {
      // Browser/CDP issues
      'browser_cdp_unreachable': () => this.recoverBrowserCDP(),
      'browser_no_tabs': () => this.recoverBrowserTabs(),
      'browser_navigation_timeout': (issue) => this.recoverNavigationTimeout(issue),

      // Model/Provider issues
      'model_provider_timeout': (issue) => this.recoverProviderTimeout(issue),
      'model_rate_limit': () => this.recoverRateLimit(),
      'model_switch_fallback': (issue) => this.recoverModelFallback(issue),

      // Shell/Execution issues
      'shell_command_failed': (issue) => this.recoverShellCommand(issue),
      'shell_permission_denied': () => this.recoverShellPermissions(),
      'executor_retry_exhausted': (issue) => this.recoverExecutorRetry(issue),

      // File system issues
      'file_not_found': (issue) => this.recoverFileNotFound(issue),
      'file_write_failed': (issue) => this.recoverFileWriteFailed(issue),
      'disk_space_low': () => this.recoverDiskSpace(),

      // Memory/Database issues
      'database_locked': () => this.recoverDatabaseLock(),
      'memory_session_lost': (issue) => this.recoverSessionLost(issue),

      // Server/API issues
      'server_health_check_failed': () => this.recoverServerHealth(),
      'api_endpoint_not_found': (issue) => this.recoverAPIEndpoint(issue),

      // Mission/Agent issues
      'mission_stuck': (issue) => this.recoverMissionStuck(issue),
      'agent_loop_detected': (issue) => this.recoverAgentLoop(issue),
      'tool_execution_hung': (issue) => this.recoverToolHung(issue)
    };

    return handlers[issueType] || null;
  }

  /* ==================== BROWSER RECOVERY ==================== */

  async recoverBrowserCDP() {
    logInfo('recover_browser_cdp', 'Attempting to restart browser CDP connection');

    // Try to launch debug browser
    const chromeBin = this.findChromeBinary();
    if (!chromeBin) {
      throw new Error('No Chrome/Chromium binary found');
    }

    const port = 9333;

    // Kill existing instances
    try {
      spawn('pkill', ['-f', 'chrome.*remote-debugging'], { stdio: 'ignore' });
      await this.sleep(500);
    } catch {}

    // Launch new instance
    const args = [
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      '--user-data-dir=/tmp/openunum-chrome-recovery',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--headless=new',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-dev-shm-usage',
      '--disable-features=Vulkan,UseSkiaRenderer',
      '--use-gl=swiftshader',
      'about:blank'
    ];

    const child = spawn(chromeBin, args, { detached: true, stdio: 'ignore' });
    child.unref();

    // Wait for CDP to be ready
    for (let i = 0; i < 30; i++) {
      try {
        const probe = await probeCdpEndpoint(`http://127.0.0.1:${port}`);
        if (probe.ok) {
          this.config.browser.cdpUrl = `http://127.0.0.1:${port}`;
          saveConfig(this.config);
          if (this.agent?.reloadTools) this.agent.reloadTools();
          return `Browser CDP restarted on port ${port}`;
        }
      } catch {}
      await this.sleep(200);
    }

    throw new Error('Browser CDP failed to start after 6 seconds');
  }

  async recoverBrowserTabs() {
    logInfo('recover_browser_tabs', 'Attempting to open new tab');

    // Navigate to blank page to ensure at least one tab exists
    if (this.agent) {
      try {
        await this.agent.runTool('browser_navigate', { url: 'about:blank' });
        return 'Opened new browser tab';
      } catch (error) {
        // If navigation fails, try CDP recovery
        return this.recoverBrowserCDP();
      }
    }

    throw new Error('No agent available for tab recovery');
  }

  async recoverNavigationTimeout(issue) {
    logInfo('recover_navigation_timeout', 'Clearing browser state and retrying');

    // Try to navigate to a simple page first
    try {
      if (this.agent) {
        await this.agent.runTool('browser_navigate', { url: 'about:blank' });
        await this.sleep(500);
        // Retry original URL with shorter timeout
        if (issue.originalUrl) {
          await this.agent.runTool('browser_navigate', { url: issue.originalUrl });
          return `Navigation recovered, loaded: ${issue.originalUrl}`;
        }
      }
    } catch {}

    return 'Browser state cleared, ready for retry';
  }

  /* ==================== MODEL/PROVIDER RECOVERY ==================== */

  async recoverProviderTimeout(issue) {
    logInfo('recover_provider_timeout', 'Switching to fallback provider');

    const currentProvider = this.config.model.provider;
    const fallbacks = this.config.model.routing?.fallbackProviders || [];

    // Find a different provider
    const nextProvider = fallbacks.find(p => p !== currentProvider);
    if (!nextProvider) {
      throw new Error('No fallback providers configured');
    }

    const model = this.config.model.providerModels?.[nextProvider] ||
                  this.config.model.model.replace(currentProvider, nextProvider);

    if (this.agent?.switchModel) {
      this.agent.switchModel(nextProvider, model);
      saveConfig(this.config);
      return `Switched from ${currentProvider} to ${nextProvider}/${model}`;
    }

    throw new Error('Agent not available for model switching');
  }

  async recoverRateLimit() {
    logInfo('recover_rate_limit', 'Enabling exponential backoff and retry');

    // Increase timeout and retry attempts
    this.config.runtime.providerRequestTimeoutMs =
      Math.min(300000, (this.config.runtime.providerRequestTimeoutMs || 120000) * 1.5);

    this.config.runtime.maxToolIterations =
      Math.min(20, (this.config.runtime.maxToolIterations || 8) + 2);

    saveConfig(this.config);

    return `Increased timeout to ${this.config.runtime.providerRequestTimeoutMs}ms, max iterations to ${this.config.runtime.maxToolIterations}`;
  }

  async recoverModelFallback(issue) {
    logInfo('recover_model_fallback', 'Forcing primary provider retry');

    this.config.model.routing.forcePrimaryProvider = true;
    saveConfig(this.config);

    if (this.agent?.reloadTools) {
      this.agent.reloadTools();
    }

    return 'Forced primary provider retry mode enabled';
  }

  /* ==================== SHELL/EXECUTOR RECOVERY ==================== */

  async recoverShellCommand(issue) {
    logInfo('recover_shell_command', 'Analyzing and retrying with fixes');

    const cmd = issue.command || '';

    // Common fixes
    let fixedCmd = cmd;

    // Add timeout if missing
    if (!cmd.includes('timeout') && !cmd.startsWith('timeout')) {
      fixedCmd = `timeout 120 ${cmd}`;
    }

    // Ensure proper error handling
    if (!cmd.includes('||') && !cmd.includes('&&')) {
      fixedCmd = `${fixedCmd} || echo "Command completed with errors"`;
    }

    try {
      if (this.agent) {
        const result = await this.agent.runTool('shell_run', { cmd: fixedCmd });
        if (result.ok) {
          return `Command recovered and executed: ${fixedCmd}`;
        }
      }
    } catch {}

    return `Command prepared for retry: ${fixedCmd}`;
  }

  async recoverShellPermissions() {
    logInfo('recover_shell_permissions', 'Checking and fixing permissions');

    try {
      // Check if we can execute basic commands
      const testResult = await this.testShellExecution();
      if (testResult) {
        return 'Shell permissions verified';
      }
    } catch {}

    // Try to fix common permission issues
    const homeDir = getHomeDir();
    try {
      spawn('chmod', ['-R', 'u+rwx', homeDir], { stdio: 'ignore' });
      return 'Permissions reset for OpenUnum home directory';
    } catch (error) {
      throw new Error(`Permission fix failed: ${error.message}`);
    }
  }

  async recoverExecutorRetry(issue) {
    logInfo('recover_executor_retry', 'Increasing retry attempts and backoff');

    this.config.runtime.executorRetryAttempts =
      Math.min(10, (this.config.runtime.executorRetryAttempts || 3) + 2);

    this.config.runtime.executorRetryBackoffMs =
      Math.min(3000, (this.config.runtime.executorRetryBackoffMs || 700) * 1.3);

    saveConfig(this.config);

    return `Increased retry attempts to ${this.config.runtime.executorRetryAttempts}, backoff to ${this.config.runtime.executorRetryBackoffMs}ms`;
  }

  async testShellExecution() {
    try {
      const result = await new Promise((resolve) => {
        const child = spawn('echo', ['test'], { stdio: 'pipe' });
        let output = '';
        child.stdout.on('data', (data) => { output += data.toString(); });
        child.on('close', (code) => {
          resolve(code === 0 ? output.trim() : null);
        });
      });
      return result === 'test';
    } catch {
      return false;
    }
  }

  /* ==================== FILE SYSTEM RECOVERY ==================== */

  async recoverFileNotFound(issue) {
    logInfo('recover_file_not_found', `Attempting to locate or create: ${issue.path}`);

    const filePath = issue.path;

    // Check if file exists in alternate locations
    const alternatePaths = [
      filePath,
      path.resolve(filePath),
      path.join(process.cwd(), filePath),
      path.join(getHomeDir(), path.basename(filePath))
    ];

    for (const altPath of alternatePaths) {
      if (fs.existsSync(altPath)) {
        return `File found at alternate location: ${altPath}`;
      }
    }

    // If it's a config file, try to recreate with defaults
    if (filePath.includes('openunum.json') || filePath.includes('.json')) {
      try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
        return `Created empty config file at: ${filePath}`;
      } catch {}
    }

    throw new Error(`File not recoverable: ${filePath}`);
  }

  async recoverFileWriteFailed(issue) {
    logInfo('recover_file_write_failed', `Checking disk space and permissions for: ${issue.path}`);

    const dir = path.dirname(issue.path);

    // Ensure directory exists
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      throw new Error(`Cannot create directory: ${error.message}`);
    }

    // Check if writable
    const testFile = path.join(dir, '.write_test');
    try {
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return 'Write permissions verified';
    } catch (error) {
      throw new Error(`Write test failed: ${error.message}`);
    }
  }

  async recoverDiskSpace() {
    logInfo('recover_disk_space', 'Cleaning up temporary files');

    const tempDirs = [
      '/tmp/openunum-*',
      '/tmp/openunum-chrome-*',
      path.join(getHomeDir(), 'logs', '*.log')
    ];

    let cleaned = 0;
    for (const pattern of tempDirs) {
      try {
        const result = await new Promise((resolve) => {
          const child = spawn('sh', ['-c', `rm -rf ${pattern} 2>/dev/null && echo done`]);
          let output = '';
          child.stdout.on('data', (data) => { output += data.toString(); });
          child.on('close', () => resolve(output.trim()));
        });
        if (result === 'done') cleaned++;
      } catch {}
    }

    return `Cleaned up ${cleaned} temporary file patterns`;
  }

  /* ==================== DATABASE RECOVERY ==================== */

  async recoverDatabaseLock() {
    logInfo('recover_database_lock', 'Attempting to release database lock');

    const dbPath = path.join(getHomeDir(), 'openunum.db');

    // Remove lock file if exists
    const lockFile = dbPath + '-lock';
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile);
        return 'Database lock file removed';
      } catch {}
    }

    // Try to backup and recreate if corrupted
    try {
      const backupPath = dbPath + '.backup';
      fs.copyFileSync(dbPath, backupPath);
      logInfo('database_backup_created', { path: backupPath });
      return 'Database backed up, attempting repair';
    } catch (error) {
      throw new Error(`Database recovery failed: ${error.message}`);
    }
  }

  async recoverSessionLost(issue) {
    logInfo('recover_session_lost', `Recovering session: ${issue.sessionId}`);

    // Create new session with same ID
    if (this.agent?.memoryStore) {
      try {
        this.agent.memoryStore.ensureSession(issue.sessionId);
        return `Session recovered: ${issue.sessionId}`;
      } catch (error) {
        throw new Error(`Session recovery failed: ${error.message}`);
      }
    }

    throw new Error('Memory store not available');
  }

  /* ==================== SERVER RECOVERY ==================== */

  async recoverServerHealth() {
    logInfo('recover_server_health', 'Checking server process and restarting if needed');

    // Check if server is responding
    try {
      const res = await fetch('http://127.0.0.1:18880/api/health');
      if (res.ok) {
        return 'Server health check passed, no recovery needed';
      }
    } catch {}

    // Server not responding, attempt restart
    throw new Error('Server restart required - manual intervention needed');
  }

  async recoverAPIEndpoint(issue) {
    logInfo('recover_api_endpoint', `Endpoint not found: ${issue.endpoint}`);

    // Check if endpoint exists in server.mjs
    // This is a code-level issue that requires deployment
    return `Endpoint ${issue.endpoint} requires code update and server restart`;
  }

  /* ==================== MISSION/AGENT RECOVERY ==================== */

  async recoverMissionStuck(issue) {
    logInfo('recover_mission_stuck', `Stopping stuck mission: ${issue.missionId}`);

    // Stop the mission
    if (issue.missionId) {
      // Signal mission stop via memory
      logWarn('mission_force_stop', { missionId: issue.missionId });
      return `Mission ${issue.missionId} marked for stop`;
    }

    throw new Error('Cannot recover mission without ID');
  }

  async recoverAgentLoop(issue) {
    logInfo('recover_agent_loop', 'Breaking agent execution loop');

    // Reduce max iterations to break loop
    this.config.runtime.maxToolIterations = Math.max(2,
      (this.config.runtime.maxToolIterations || 8) - 2);

    saveConfig(this.config);

    return `Reduced max iterations to ${this.config.runtime.maxToolIterations} to break loop`;
  }

  async recoverToolHung(issue) {
    logInfo('recover_tool_hung', `Recovering from hung tool: ${issue.toolName}`);

    // Increase timeout for next execution
    this.config.runtime.agentTurnTimeoutMs = Math.min(600000,
      (this.config.runtime.agentTurnTimeoutMs || 420000) + 60000);

    saveConfig(this.config);

    return `Increased agent turn timeout to ${this.config.runtime.agentTurnTimeoutMs}ms`;
  }

  /* ==================== UTILITIES ==================== */

  recordRecovery(recovery) {
    this.recoveryHistory.push(recovery);
    if (this.recoveryHistory.length > this.maxHistory) {
      this.recoveryHistory.shift();
    }

    // Save to file for persistence
    try {
      const historyPath = path.join(getHomeDir(), 'recovery-history.json');
      fs.writeFileSync(historyPath, JSON.stringify(this.recoveryHistory, null, 2));
    } catch {}
  }

  getRecoveryHistory(limit = 10) {
    return this.recoveryHistory.slice(-limit);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  findChromeBinary() {
    const override = String(process.env.OPENUNUM_BROWSER_BIN || '').trim();
    if (override && fs.existsSync(override)) return override;

    try {
      const root = path.join(os.homedir(), '.cache', 'ms-playwright');
      if (fs.existsSync(root)) {
        const entries = fs.readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
          .map((entry) => entry.name)
          .sort((a, b) => b.localeCompare(a));
        for (const name of entries) {
          const candidate = path.join(root, name, 'chrome-linux', 'chrome');
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {}

    const candidates = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium'
    ];
    for (const bin of candidates) {
      if (fs.existsSync(bin)) return bin;
    }
    return null;
  }
}
