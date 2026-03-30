import { loadConfig, saveConfig, defaultConfig, getHomeDir } from '../config.mjs';
import { MemoryStore } from '../memory/store.mjs';
import { OpenUnumAgent } from './agent.mjs';
import { CDPBrowser } from '../browser/cdp.mjs';
import { SelfHealMonitor } from './selfheal.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export class SelfTestSuite {
  constructor({ config, agent, browser, memory, selfHealMonitor }) {
    this.config = config;
    this.agent = agent;
    this.browser = browser;
    this.memory = memory;
    selfHealMonitor = selfHealMonitor;
    this.results = [];
    this.criticalFailures = 0;
  }

  async runAllTests() {
    this.results = [];
    this.criticalFailures = 0;
    const timestamp = new Date().toISOString();

    // Core system tests
    await this.testConfigIntegrity();
    await this.testMemoryStore();
    await this.testFileSystem();
    await this.testShellExecution();
    await this.testAgentChat();
    await this.testBrowserConnectivity();
    await this.testSelfHeal();
    await this.testToolRuntime();
    await this.testProviderFallback();
    await this.testMissionRunner();

    const summary = {
      timestamp,
      total: this.results.length,
      passed: this.results.filter(r => r.passed).length,
      failed: this.results.filter(r => !r.passed).length,
      criticalFailures: this.criticalFailures,
      results: this.results,
      overallOk: this.criticalFailures === 0
    };

    // Save test results
    const resultsDir = path.join(getHomeDir(), 'logs', 'self-tests');
    fs.mkdirSync(resultsDir, { recursive: true });
    const resultsFile = path.join(resultsDir, `test-run-${Date.now()}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify(summary, null, 2));

    // Keep only last 10 test runs
    const allFiles = fs.readdirSync(resultsDir)
      .filter(f => f.startsWith('test-run-'))
      .sort()
      .reverse();
    allFiles.slice(10).forEach(f => {
      try { fs.unlinkSync(path.join(resultsDir, f)); } catch {}
    });

    return summary;
  }

  async testConfigIntegrity() {
    const test = { name: 'config_integrity', category: 'core' };
    try {
      const cfg = loadConfig();
      const required = ['server', 'browser', 'runtime', 'model', 'channels'];
      const missing = required.filter(k => !cfg[k]);
      if (missing.length > 0) {
        test.passed = false;
        test.error = `Missing config sections: ${missing.join(', ')}`;
        this.criticalFailures += 1;
      } else {
        test.passed = true;
        test.details = { sections: required };
      }
    } catch (error) {
      test.passed = false;
      test.error = String(error.message || error);
      this.criticalFailures += 1;
    }
    this.results.push(test);
  }

  async testMemoryStore() {
    const test = { name: 'memory_store', category: 'core' };
    try {
      const testSession = `self-test-${Date.now()}`;
      this.memory.addMessage(testSession, 'user', 'test message');
      const msgs = this.memory.getMessages(testSession, 10);
      if (msgs.length === 0) {
        test.passed = false;
        test.error = 'No messages retrieved';
        this.criticalFailures += 1;
      } else {
        test.passed = true;
        test.details = { messagesCount: msgs.length };
      }
    } catch (error) {
      test.passed = false;
      test.error = String(error.message || error);
      this.criticalFailures += 1;
    }
    this.results.push(test);
  }

  async testFileSystem() {
    const test = { name: 'file_system', category: 'core' };
    try {
      const testDir = path.join(getHomeDir(), 'self-test');
      const testFile = path.join(testDir, 'test.txt');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(testFile, 'self-test-content', 'utf8');
      const content = fs.readFileSync(testFile, 'utf8');
      fs.unlinkSync(testFile);
      fs.rmdirSync(testDir);
      if (content === 'self-test-content') {
        test.passed = true;
        test.details = { readWrite: 'ok' };
      } else {
        test.passed = false;
        test.error = 'Content mismatch';
      }
    } catch (error) {
      test.passed = false;
      test.error = String(error.message || error);
      this.criticalFailures += 1;
    }
    this.results.push(test);
  }

  async testShellExecution() {
    const test = { name: 'shell_execution', category: 'tools' };
    try {
      const result = await this.agent.runTool('shell_run', { cmd: 'echo "self-test-ok"' });
      if (result.ok && result.stdout?.includes('self-test-ok')) {
        test.passed = true;
        test.details = { shellEnabled: true };
      } else {
        test.passed = false;
        test.error = result.error || 'Shell execution failed';
      }
    } catch (error) {
      test.passed = false;
      test.error = String(error.message || error);
    }
    this.results.push(test);
  }

  async testAgentChat() {
    const test = { name: 'agent_chat', category: 'core' };
    try {
      const sessionId = `self-test-chat-${Date.now()}`;
      const result = await this.agent.chat({
        message: 'What is 2+2? Answer with just the number.',
        sessionId
      });
      if (result.reply && result.reply.includes('4')) {
        test.passed = true;
        test.details = { responseLength: result.reply.length };
      } else {
        test.passed = false;
        test.error = 'Unexpected response';
        test.details = { reply: result.reply?.substring(0, 100) };
      }
    } catch (error) {
      test.passed = false;
      test.error = String(error.message || error);
      this.criticalFailures += 1;
    }
    this.results.push(test);
  }

  async testBrowserConnectivity() {
    const test = { name: 'browser_connectivity', category: 'browser' };
    try {
      const status = await this.browser.status();
      if (status.ok) {
        test.passed = true;
        test.details = { cdpUrl: this.config.browser?.cdpUrl };
      } else {
        test.passed = false;
        test.error = status.error || 'Browser not connected';
        test.hint = 'Try POST /api/browser/launch';
      }
    } catch (error) {
      test.passed = false;
      test.error = String(error.message || error);
    }
    this.results.push(test);
  }

  async testSelfHeal() {
    const test = { name: 'self_heal', category: 'recovery' };
    try {
      if (!this.selfHealMonitor) {
        test.passed = false;
        test.error = 'SelfHealMonitor not available';
        this.results.push(test);
        return;
      }
      const health = await this.selfHealMonitor.runFullHealthCheck();
      if (health.ok) {
        test.passed = true;
        test.details = { checks: Object.keys(health.checks) };
      } else {
        test.passed = false;
        test.error = 'Health check failed';
        test.details = health.checks;
      }
    } catch (error) {
      test.passed = false;
      test.error = String(error.message || error);
    }
    this.results.push(test);
  }

  async testToolRuntime() {
    const test = { name: 'tool_runtime', category: 'tools' };
    try {
      const tools = this.agent.toolRuntime.toolSchemas();
      if (tools.length >= 10) {
        test.passed = true;
        test.details = { toolCount: tools.length };
      } else {
        test.passed = false;
        test.error = `Only ${tools.length} tools available`;
      }
    } catch (error) {
      test.passed = false;
      test.error = String(error.message || error);
    }
    this.results.push(test);
  }

  async testProviderFallback() {
    const test = { name: 'provider_fallback', category: 'models' };
    try {
      const attempts = this.agent.buildProviderAttempts();
      if (attempts.length >= 1) {
        test.passed = true;
        test.details = { providers: attempts.map(a => a.provider) };
      } else {
        test.passed = false;
        test.error = 'No provider attempts configured';
      }
    } catch (error) {
      test.passed = false;
      test.error = String(error.message || error);
    }
    this.results.push(test);
  }

  async testMissionRunner() {
    const test = { name: 'mission_runner', category: 'missions' };
    try {
      // Import MissionRunner dynamically
      const { MissionRunner } = await import('./missions.mjs');
      const runner = new MissionRunner({ agent: this.agent, memoryStore: this.memory });
      const missions = runner.list();
      test.passed = true;
      test.details = { activeMissions: missions.length };
    } catch (error) {
      test.passed = false;
      test.error = String(error.message || error);
    }
    this.results.push(test);
  }

  getSummary() {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    return {
      total: this.results.length,
      passed,
      failed,
      criticalFailures: this.criticalFailures,
      overallOk: this.criticalFailures === 0
    };
  }
}

export async function runSelfTest() {
  const config = loadConfig();
  const memory = new MemoryStore();
  const agent = new OpenUnumAgent({ config, memoryStore: memory });
  const browser = new CDPBrowser(config.browser?.cdpUrl);
  const selfHealMonitor = new SelfHealMonitor({ config, agent, browser, memory });
  const suite = new SelfTestSuite({ config, agent, browser, memory, selfHealMonitor });
  return suite.runAllTests();
}
