#!/usr/bin/env node
/**
 * OpenUnum Bootstrap Script
 * Initializes, tests, and starts the OpenUnum system with self-healing
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME_DIR = process.env.OPENUNUM_HOME || path.join(process.env.HOME, '.openunum');

function log(msg, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`, Object.keys(data).length ? JSON.stringify(data) : '');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function checkDependencies() {
  const missing = [];
  
  // Check Node.js
  try {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);
    if (major < 18) {
      missing.push('Node.js >= 18 (current: ' + version + ')');
    }
  } catch {
    missing.push('Node.js');
  }

  // Check required modules
  const requiredModules = ['marked', 'sanitize-html', 'dotenv', 'chrome-remote-interface'];
  for (const mod of requiredModules) {
    try {
      import.meta.resolve(mod);
    } catch {
      missing.push(mod);
    }
  }

  return missing;
}

function checkSystemTools() {
  const tools = [
    { name: 'curl', cmd: 'curl --version' },
    { name: 'git', cmd: 'git --version' }
  ];
  
  const missing = [];
  for (const tool of tools) {
    try {
      execSync(tool.cmd, { stdio: 'ignore' });
    } catch {
      missing.push(tool.name);
    }
  }
  
  return missing;
}

async function runHealthCheck() {
  log('Running initial health check...');
  try {
    const res = await fetch('http://127.0.0.1:18880/api/health');
    const health = await res.json();
    return health;
  } catch {
    return { ok: false, error: 'server_not_running' };
  }
}

async function startServer() {
  return new Promise((resolve, reject) => {
    log('Starting OpenUnum server...');
    const server = spawn('node', ['src/server.mjs'], {
      cwd: __dirname,
      stdio: 'inherit',
      detached: false
    });

    server.on('error', reject);
    
    // Wait for server to be ready
    let ready = false;
    const checkReady = async () => {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        const health = await runHealthCheck();
        if (health.ok) {
          ready = true;
          break;
        }
      }
      if (ready) {
        resolve(server);
      } else {
        reject(new Error('Server failed to start'));
      }
    };
    
    checkReady();
  });
}

async function runSelfTest() {
  log('Running self-test suite...');
  try {
    execSync('node tests/self-test-runner.mjs', {
      cwd: __dirname,
      stdio: 'inherit'
    });
    return { ok: true };
  } catch (error) {
    log('Self-test failed', { error: error.message });
    return { ok: false, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'start';

  log('OpenUnum Bootstrap', { command, home: HOME_DIR });

  // Ensure home directory exists
  ensureDir(HOME_DIR);
  ensureDir(path.join(HOME_DIR, 'logs'));
  ensureDir(path.join(HOME_DIR, 'skills'));

  // Check dependencies
  const missingDeps = checkDependencies();
  if (missingDeps.length > 0) {
    log('ERROR: Missing dependencies', { missing: missingDeps });
    console.log('\nInstall with: pnpm install\n');
    process.exit(1);
  }

  // Check system tools
  const missingTools = checkSystemTools();
  if (missingTools.length > 0) {
    log('WARNING: Missing system tools', { missing: missingTools });
  }

  if (command === 'start') {
    // Check if already running
    const health = await runHealthCheck();
    if (health.ok) {
      log('Server already running', health);
      return;
    }

    // Start server
    await startServer();
    log('Server started successfully');

    // Optional: run self-test after start
    if (args.includes('--test')) {
      const testResult = await runSelfTest();
      if (!testResult.ok) {
        log('Self-test failed but server is running');
      }
    }
  } else if (command === 'test') {
    await runSelfTest();
  } else if (command === 'health') {
    const health = await runHealthCheck();
    console.log(JSON.stringify(health, null, 2));
  } else if (command === 'fix') {
    log('Running self-heal...');
    try {
      const res = await fetch('http://127.0.0.1:18880/api/self-heal/fix', {
        method: 'POST'
      });
      const result = await res.json();
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      log('Self-heal failed', { error: error.message });
    }
  } else {
    console.log('Usage: node bootstrap.mjs [start|test|health|fix] [--test]');
  }
}

main().catch(error => {
  log('Bootstrap failed', { error: error.message });
  process.exit(1);
});
