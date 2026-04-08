#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { getSelfMonitor } from '../src/core/self-monitor.mjs';

function loadWorkingMemoryAnchors(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const files = fs.readdirSync(rootDir).filter((name) => name.endsWith('.json'));
  const anchors = [];
  for (const file of files) {
    const filePath = path.join(rootDir, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      anchors.push({ file, filePath, parsed });
    } catch {}
  }
  return anchors;
}

function extractRecoveryGoals(anchors) {
  return anchors
    .map((item) => String(item.parsed?.userOrigin || ''))
    .filter(Boolean)
    .filter((text) => text.includes('tool_circuit_open'))
    .slice(0, 10);
}

function buildFailedToolRuns() {
  return [
    {
      name: 'file_read',
      args: { path: 'src/core/agent.mjs' },
      result: { ok: false, error: 'tool_circuit_open' }
    }
  ];
}

async function main() {
  const workspaceRoot = process.cwd();
  const workingMemoryDir = path.join(workspaceRoot, 'data', 'working-memory');
  const anchors = loadWorkingMemoryAnchors(workingMemoryDir);
  const goals = extractRecoveryGoals(anchors);

  console.log('Session Imitation Regression');
  console.log('============================');
  console.log(`anchors_scanned=${anchors.length}`);
  console.log(`recovery_goals=${goals.length}`);

  const monitor = getSelfMonitor(null);
  const selectedGoals = goals.length ? goals : [
    'Tool file_read failed 2 times. Last error: tool_circuit_open. Diagnose and continue safely.'
  ];

  let failures = 0;
  for (let i = 0; i < selectedGoals.length; i += 1) {
    const sessionId = `imitation-${i}-${Date.now()}`;
    const goal = selectedGoals[i];
    monitor.startMonitoring(sessionId, goal);
    const shouldContinue = monitor.shouldAutoContinue(sessionId, 'Status: partial\nNeed next action.', buildFailedToolRuns());
    const directive = monitor.generateContinuationPrompt(sessionId, 'Status: partial', buildFailedToolRuns());

    if (!shouldContinue || !directive.includes('AUTONOMOUS CONTINUATION DIRECTIVE')) {
      failures += 1;
      console.log(`FAIL goal[${i}] ${goal.slice(0, 90)}`);
    } else {
      console.log(`PASS goal[${i}] continuation directive emitted`);
    }
    monitor.stopMonitoring(sessionId);
  }

  if (failures > 0) {
    console.error(`Regression failed: ${failures} case(s)`);
    process.exit(1);
  }

  console.log('Session imitation regression passed.');
}

main().catch((error) => {
  console.error('session imitation regression error:', error.message);
  process.exit(1);
});
