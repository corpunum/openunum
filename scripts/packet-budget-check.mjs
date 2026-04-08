#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRuntimeStatePacket } from '../src/core/runtime-state-contract.mjs';
import { ContextCompiler } from '../src/core/context-compiler.mjs';

const MAX_RUNTIME_PACKET_BYTES = Number(process.env.OPENUNUM_RUNTIME_PACKET_MAX_BYTES || 16384);
const MAX_CONTEXT_PACKET_CHARS = Number(process.env.OPENUNUM_CONTEXT_PACKET_MAX_CHARS || 48000);

function makeLongList(prefix, count, width = 64) {
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}-${'x'.repeat(width)}`);
}

function checkRuntimePacketBudget() {
  const packet = buildRuntimeStatePacket({
    sessionId: 'budget-check-session',
    goal: 'Verify runtime packet budget envelopes remain bounded for compact profiles',
    phase: 'phase3',
    nextAction: 'Fail gate if packet grows unexpectedly',
    verifiedObservations: makeLongList('obs', 18, 80),
    blockers: makeLongList('blocker', 10, 60),
    activeArtifacts: makeLongList('artifact', 12, 72),
    permissions: {
      shell: true,
      network: true,
      browser: true,
      fileWrite: true
    },
    metadata: {
      gate: 'packet-budget-check',
      profile: 'compact',
      version: 1
    }
  });

  const bytes = Buffer.byteLength(JSON.stringify(packet), 'utf8');
  return { ok: bytes <= MAX_RUNTIME_PACKET_BYTES, bytes, max: MAX_RUNTIME_PACKET_BYTES };
}

function checkContextPacketBudget() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-ctx-budget-'));
  const compiler = new ContextCompiler({ workspaceRoot: tmpRoot, maxRecentTurns: 4 });

  const context = compiler.compile({
    executionState: {
      taskId: 'budget-task',
      currentStep: 2,
      totalSteps: 8,
      completedSteps: ['a', 'b'],
      failedSteps: [],
      toolHistory: [{ tool: 'file_search' }, { tool: 'shell_run' }],
      currentSubplan: { index: 0, title: 'Phase 3', steps: ['gate', 'verify', 'report'] }
    },
    workingMemoryAnchor: {
      userOrigin: 'Harden OpenUnum packet budgeting for compact model profiles',
      planAgreed: 'Add deterministic packet and docs-contract gates, run all tests, push to main',
      contract: {
        successCriteria: 'Phase 3 gates block regressions before deployment',
        forbiddenDrift: ['No architecture rewrite', 'No silent gate bypass'],
        requiredOutputs: ['scripts', 'tests', 'docs updates']
      },
      subplans: [{ title: 'Phase 3 hardening' }],
      currentSubplanIndex: 0
    },
    recalledMemories: Array.from({ length: 10 }, (_, i) => ({
      id: `mem-${i + 1}`,
      text: `memory ${i + 1}: ${'x'.repeat(1200)}`,
      similarity: 0.91
    })),
    recentMessages: Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `${i % 2 === 0 ? 'Request' : 'Response'} ${i + 1}: ${'y'.repeat(1000)}`
    }))
  });

  const chars = context.length;
  return { ok: chars <= MAX_CONTEXT_PACKET_CHARS, chars, max: MAX_CONTEXT_PACKET_CHARS };
}

const runtime = checkRuntimePacketBudget();
const context = checkContextPacketBudget();

console.log(`[packet-budget] runtime_packet_bytes=${runtime.bytes} max=${runtime.max}`);
console.log(`[packet-budget] context_packet_chars=${context.chars} max=${context.max}`);

if (!runtime.ok || !context.ok) {
  console.error('[packet-budget] FAIL: packet budget exceeded');
  process.exit(1);
}

console.log('[packet-budget] PASS');
