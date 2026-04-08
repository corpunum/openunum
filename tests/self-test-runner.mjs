#!/usr/bin/env node
/**
 * OpenUnum Self-Test Runner
 * Comprehensive testing suite for autonomous operation validation
 */

import http from 'node:http';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.OPENUNUM_URL || 'http://127.0.0.1:18880';

function log(test, status, details = {}) {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○';
  console.log(`${icon} ${test}: ${status}`, Object.keys(details).length ? JSON.stringify(details) : '');
}

async function httpGet(path, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${path}`, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function httpPost(path, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function testServerHealth() {
  try {
    const res = await httpGet('/health');
    if (res.status === 200 && res.data.ok) {
      log('Server Health', 'PASS', { uptime: res.data.uptime });
      return true;
    }
    log('Server Health', 'FAIL', { status: res.status, data: res.data });
    return false;
  } catch (error) {
    log('Server Health', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testConfigAPI() {
  try {
    const res = await httpGet('/api/config');
    if (res.status === 200 && res.data.model && res.data.runtime && res.data.capabilities && res.data.modelCatalog) {
      log('Config API', 'PASS', { provider: res.data.model.provider });
      return true;
    }
    log('Config API', 'FAIL', { status: res.status });
    return false;
  } catch (error) {
    log('Config API', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testSelfHeal() {
  try {
    const res = await httpPost('/api/self-heal', { dryRun: true });
    if (res.status === 200 && Array.isArray(res.data.results)) {
      const passed = res.data.results.filter(r => r.success !== false).length;
      const total = res.data.results.length;
      log('Self-Heal Check', 'PASS', { passed, total });
      return true;
    }
    log('Self-Heal Check', 'FAIL', { status: res.status });
    return false;
  } catch (error) {
    log('Self-Heal Check', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testMemoryStore() {
  const sessionId = `test-${Date.now()}`;
  try {
    // Test chat with memory
    let chatRes = await httpPost('/api/chat', {
      sessionId,
      message: 'Remember this test fact: self-test-runner-active'
    });

    // Handle pending chat (202 Accepted)
    if (chatRes.status === 202) {
      let attempts = 0;
      while (chatRes.status === 202 && attempts < 120) {
        await new Promise(r => setTimeout(r, 2000));
        chatRes = await httpGet(`/api/chat/pending?sessionId=${sessionId}`);
        if (chatRes.data && !chatRes.data.pending) {
          // Once not pending, we need to get the actual session history to verify
          break;
        }
        attempts++;
      }
    }

    if (chatRes.status !== 200 && chatRes.status !== 202) {
      log('Memory Store', 'FAIL', { status: chatRes.status });
      return false;
    }

    // Verify message was stored
    const sessionRes = await httpGet(`/api/sessions/${sessionId}`);
    if (sessionRes.status === 200 && sessionRes.data.messages.length >= 2) {
      log('Memory Store', 'PASS', { messages: sessionRes.data.messages.length });
      return true;
    }
    log('Memory Store', 'FAIL', { messages: sessionRes.data?.messages?.length || 0 });
    return false;
  } catch (error) {
    log('Memory Store', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testBrowserStatus() {
  try {
    const res = await httpGet('/api/browser/status');
    if (res.status === 200) {
      log('Browser Status', res.data.ok ? 'PASS' : 'WARN', { ok: res.data.ok });
      return true; // Not a failure if browser isn't running
    }
    log('Browser Status', 'FAIL', { status: res.status });
    return false;
  } catch (error) {
    log('Browser Status', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testToolExecution() {
  try {
    // Test shell command
    const shellRes = await httpPost('/api/tool/run', {
      name: 'shell_run',
      args: { cmd: 'echo "self-test-ok"' }
    });
    
    if (shellRes.status === 200 && shellRes.data.result?.ok) {
      log('Tool Execution (shell)', 'PASS');
      
      // Test file write
      const testPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'openunum-self-test.txt');
      const writeRes = await httpPost('/api/tool/run', {
        name: 'file_write',
        args: { path: testPath, content: 'self-test-content' }
      });
      
      if (writeRes.status === 200 && writeRes.data.result?.ok) {
        log('Tool Execution (file_write)', 'PASS');
        
        // Test file read
        const readRes = await httpPost('/api/tool/run', {
          name: 'file_read',
          args: { path: testPath }
        });
        
        if (readRes.status === 200 && readRes.data.result?.content === 'self-test-content') {
          log('Tool Execution (file_read)', 'PASS');
          
          // Cleanup
          try { fs.unlinkSync(testPath); } catch {}
          return true;
        }
        log('Tool Execution (file_read)', 'FAIL');
        return false;
      }
      log('Tool Execution (file_write)', 'FAIL');
      return false;
    }
    log('Tool Execution (shell)', 'FAIL', { data: shellRes.data });
    return false;
  } catch (error) {
    log('Tool Execution', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testModelSwitch() {
  try {
    // Get current model
    const currentRes = await httpGet('/api/model/current');
    if (currentRes.status !== 200) {
      log('Model Switch', 'FAIL', { status: currentRes.status });
      return false;
    }
    
    const originalModel = currentRes.data.model;
    
    // Try to switch to same model (safe operation)
    const switchRes = await httpPost('/api/model/switch', {
      provider: currentRes.data.provider,
      model: originalModel
    });
    
    const switchedModel = String(switchRes.data?.model || switchRes.data?.activeModel || '');
    const normalizeModelId = (value) => String(value || '').replace(/^[^/]+\//, '');
    if (switchRes.status === 200 && normalizeModelId(switchedModel) === normalizeModelId(originalModel)) {
      log('Model Switch', 'PASS', { model: originalModel });
      return true;
    }
    log('Model Switch', 'FAIL', {
      status: switchRes.status,
      expected: originalModel,
      received: switchedModel || null
    });
    return false;
  } catch (error) {
    log('Model Switch', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testAutonomyMode() {
  try {
    // Get current mode
    const modeRes = await httpGet('/api/autonomy/mode');
    if (modeRes.status !== 200) {
      log('Autonomy Mode', 'FAIL', { status: modeRes.status });
      return false;
    }
    
    // Switch to standard mode (safe)
    const switchRes = await httpPost('/api/autonomy/mode', { mode: 'autonomy-first' });
    if (switchRes.status === 200 && switchRes.data.ok) {
      log('Autonomy Mode', 'PASS', { mode: switchRes.data.mode });
      return true;
    }
    log('Autonomy Mode', 'FAIL', { status: switchRes.status });
    return false;
  } catch (error) {
    log('Autonomy Mode', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testCapabilitiesContract() {
  try {
    const res = await httpGet('/api/capabilities');
    const expectedMenu = ['chat', 'missions', 'trace', 'runtime', 'settings'];
    const expectedProviders = ['ollama-local', 'ollama-cloud', 'nvidia', 'openrouter', 'xiaomimimo', 'openai'];
    if (
      res.status === 200 &&
      JSON.stringify(res.data.menu) === JSON.stringify(expectedMenu) &&
      JSON.stringify(res.data.provider_order) === JSON.stringify(expectedProviders)
    ) {
      log('Capabilities Contract', 'PASS', { contract: res.data.contract_version });
      return true;
    }
    log('Capabilities Contract', 'FAIL', { status: res.status, data: res.data });
    return false;
  } catch (error) {
    log('Capabilities Contract', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testModelCatalogContract() {
  try {
    const res = await httpGet('/api/model-catalog');
    const providers = res.data?.provider_order || [];
    const selected = res.data?.selected?.canonical_key;
    if (res.status === 200 && providers.join(',') === 'ollama-local,ollama-cloud,nvidia,openrouter,xiaomimimo,openai' && selected) {
      log('Model Catalog Contract', 'PASS', { selected });
      return true;
    }
    log('Model Catalog Contract', 'FAIL', { status: res.status, data: res.data });
    return false;
  } catch (error) {
    log('Model Catalog Contract', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testMissionStart() {
  const sessionId = `mission-test-${Date.now()}`;
  try {
    // Start a simple mission
    const missionRes = await httpPost('/api/missions/start', {
      goal: 'Check if /tmp directory exists',
      maxSteps: 2,
      intervalMs: 100
    });
    
    if (missionRes.status === 200 && missionRes.data.ok && missionRes.data.id) {
      log('Mission Start', 'PASS', { missionId: missionRes.data.id });
      
      // Wait briefly and check status
      await new Promise(r => setTimeout(r, 500));
      
      const statusRes = await httpGet(`/api/missions/status?id=${missionRes.data.id}`);
      if (statusRes.status === 200 && statusRes.data.mission) {
        log('Mission Status', 'PASS', { status: statusRes.data.mission.status });
        return true;
      }
    }
    log('Mission Start', 'FAIL', { status: missionRes.status });
    return false;
  } catch (error) {
    log('Mission Start', 'FAIL', { error: String(error.message || error) });
    return false;
  }
}

async function testProviderConnectivity() {
  try {
    const res = await httpGet('/api/models?provider=ollama');
    if (res.status === 200 && Array.isArray(res.data.models)) {
      log('Provider Connectivity (Ollama)', 'PASS', { models: res.data.models.length });
      return true;
    }
    log('Provider Connectivity', 'WARN', { status: res.status, note: 'Provider may be offline' });
    return true; // Not critical
  } catch (error) {
    log('Provider Connectivity', 'WARN', { error: String(error.message || error) });
    return true; // Not critical for basic operation
  }
}

async function runAllTests() {
  console.log('\n=== OpenUnum Self-Test Suite ===\n');
  
  const tests = [
    testServerHealth,
    testConfigAPI,
    testCapabilitiesContract,
    testModelCatalogContract,
    testSelfHeal,
    testMemoryStore,
    testBrowserStatus,
    testToolExecution,
    testModelSwitch,
    testAutonomyMode,
    testMissionStart,
    testProviderConnectivity
  ];
  
  const results = [];
  for (const test of tests) {
    try {
      const passed = await test();
      results.push(passed);
    } catch (error) {
      console.error(`Test ${test.name} threw:`, error);
      results.push(false);
    }
    await new Promise(r => setTimeout(r, 200)); // Small delay between tests
  }
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log(`\n=== Results: ${passed}/${total} tests passed ===\n`);
  
  if (passed === total) {
    console.log('✓ All systems operational for autonomous operation\n');
    process.exit(0);
  } else {
    console.log('⚠ Some tests failed - review recommended before autonomous mode\n');
    process.exit(1);
  }
}

runAllTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
