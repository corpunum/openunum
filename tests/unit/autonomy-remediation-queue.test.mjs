import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AutonomyRemediationQueue } from '../../src/core/autonomy-remediation-queue.mjs';

const tmpRoots = [];

function makeHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-remediation-queue-'));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  while (tmpRoots.length) {
    const root = tmpRoots.pop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('autonomy remediation queue', () => {
  it('creates and transitions remediation items', () => {
    const queue = new AutonomyRemediationQueue({ homeDir: makeHome() });
    const created = queue.create({
      title: 'Fix response drift',
      source: 'manual',
      actions: ['Reproduce', 'Patch', 'Verify']
    });
    expect(created.ok).toBe(true);
    const id = created.item.id;

    const running = queue.transition(id, 'running');
    expect(running.ok).toBe(true);
    expect(running.item.status).toBe('running');

    const resolved = queue.transition(id, 'resolved', { resolution: 'tests green' });
    expect(resolved.ok).toBe(true);
    expect(resolved.item.status).toBe('resolved');
    expect(resolved.item.resolution).toBe('tests green');
  });

  it('upserts self-awareness remediation only for degraded scores', () => {
    const queue = new AutonomyRemediationQueue({ homeDir: makeHome() });
    const healthy = queue.ensureSelfAwarenessRemediation({ score: 90, issues: [] });
    expect(healthy.ok).toBe(true);
    expect(healthy.skipped).toBe(true);

    const degraded = queue.ensureSelfAwarenessRemediation({
      score: 61,
      issues: ['Recovery-format replies detected (2).']
    });
    expect(degraded.ok).toBe(true);
    expect(degraded.upserted).toBe(true);
    expect(degraded.item.status).toBe('queued');

    const second = queue.ensureSelfAwarenessRemediation({
      score: 59,
      issues: ['Recovery-format replies detected (3).']
    });
    expect(second.ok).toBe(true);
    expect(second.mode).toBe('updated');
    expect(second.item.observedCount).toBeGreaterThan(1);
  });

  it('upserts pending-queue remediation when queue is stalled', () => {
    const queue = new AutonomyRemediationQueue({ homeDir: makeHome() });
    const healthy = queue.ensurePendingQueueRemediation({
      pendingCount: 1,
      stuckCount: 0,
      oldestAgeMs: 1000,
      thresholdMs: 45000
    });
    expect(healthy.ok).toBe(true);
    expect(healthy.skipped).toBe(true);

    const stalled = queue.ensurePendingQueueRemediation({
      pendingCount: 3,
      stuckCount: 2,
      oldestAgeMs: 93000,
      thresholdMs: 45000
    });
    expect(stalled.ok).toBe(true);
    expect(stalled.upserted).toBe(true);
    expect(stalled.item.title).toContain('Pending chat queue stalled');
  });
});
