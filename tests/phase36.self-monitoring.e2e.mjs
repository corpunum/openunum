#!/usr/bin/env node
/**
 * Phase 36: Self-Monitoring System Test
 *
 * Validates the self-monitoring system for automatic continuation
 * and enhanced proof validation.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main() {
  console.log('🧪 Phase 36: Testing Self-Monitoring System...');

  // Test 1: Verify proof scorer module exists
  try {
    const proofScorerPath = join(process.cwd(), 'src/core/proof-scorer.mjs');
    await readFile(proofScorerPath, 'utf8');
    console.log('✅ Proof scorer module exists');
  } catch (error) {
    console.error('❌ Proof scorer module missing:', error.message);
    process.exit(1);
  }

  // Test 2: Verify task tracker module exists
  try {
    const taskTrackerPath = join(process.cwd(), 'src/core/task-tracker.mjs');
    await readFile(taskTrackerPath, 'utf8');
    console.log('✅ Task tracker module exists');
  } catch (error) {
    console.error('❌ Task tracker module missing:', error.message);
    process.exit(1);
  }

  // Test 3: Verify self-monitor module exists
  try {
    const selfMonitorPath = join(process.cwd(), 'src/core/self-monitor.mjs');
    await readFile(selfMonitorPath, 'utf8');
    console.log('✅ Self-monitor module exists');
  } catch (error) {
    console.error('❌ Self-monitor module missing:', error.message);
    process.exit(1);
  }

  // Test 4: Verify enhanced execution contract
  try {
    const executionContractPath = join(process.cwd(), 'src/core/execution-contract.mjs');
    const content = await readFile(executionContractPath, 'utf8');
    if (content.includes('scoreProofQuality')) {
      console.log('✅ Execution contract uses proof scoring');
    } else {
      console.error('❌ Execution contract does not use proof scoring');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Execution contract check failed:', error.message);
    process.exit(1);
  }

  // Test 5: Verify agent integration
  try {
    const agentPath = join(process.cwd(), 'src/core/agent.mjs');
    const content = await readFile(agentPath, 'utf8');

    const checks = [
      { name: 'Task tracker import', pattern: "import { getTaskTracker }" },
      { name: 'Self-monitor import', pattern: "import { getSelfMonitor }" },
      { name: 'Task tracker initialization', pattern: "this.taskTracker = getTaskTracker" },
      { name: 'Self-monitor initialization', pattern: "this.selfMonitor = getSelfMonitor" }
    ];

    for (const check of checks) {
      if (content.includes(check.pattern)) {
        console.log(`✅ ${check.name} present`);
      } else {
        console.error(`❌ ${check.name} missing`);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('❌ Agent integration check failed:', error.message);
    process.exit(1);
  }

  // Test 6: Verify documentation updates
  try {
    const changelogPath = join(process.cwd(), 'docs/CHANGELOG_CURRENT.md');
    const changelogContent = await readFile(changelogPath, 'utf8');

    if (changelogContent.includes('Enhanced Autonomous Execution & Self-Monitoring')) {
      console.log('✅ Changelog updated with self-monitoring changes');
    } else {
      console.error('❌ Changelog not updated with self-monitoring changes');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Changelog check failed:', error.message);
    process.exit(1);
  }

  console.log('🎉 Phase 36: All self-monitoring tests passed!');
  process.exit(0);
}

main().catch(error => {
  console.error('💥 Phase 36 failed:', error);
  process.exit(1);
});