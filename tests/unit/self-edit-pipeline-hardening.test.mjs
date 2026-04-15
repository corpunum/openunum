import { describe, expect, it } from 'vitest';
import { SelfEditPipeline } from '../../src/core/self-edit-pipeline.mjs';

function createToolRuntime() {
  const calls = [];
  return {
    calls,
    async run(name, args) {
      calls.push({ name, args });
      if (name === 'file_restore_last') {
        return { ok: true, path: args.path };
      }
      if (name === 'file_patch' || name === 'file_write') {
        return { ok: true, path: args.path };
      }
      if (name === 'shell_run') {
        return { ok: true, code: 0, stdout: 'ok' };
      }
      return { ok: false, error: `unsupported:${name}` };
    }
  };
}

function createMemoryStore() {
  return {
    markRunningSelfEditInterrupted() {},
    upsertSelfEditRecord() {},
    addMemoryArtifact() {},
    recordStrategyOutcome() {},
    rememberFact() {},
    listSessions() { return []; },
    getMessagesForContext() { return []; }
  };
}

describe('self-edit pipeline hardening', () => {
  it('blocks protected paths without elevated approval', async () => {
    const runtime = createToolRuntime();
    const pipeline = new SelfEditPipeline({
      toolRuntime: runtime,
      memoryStore: createMemoryStore(),
      workspaceRoot: process.cwd()
    });
    const out = await pipeline.run({
      goal: 'unsafe mutation',
      edits: [
        {
          tool: 'file_patch',
          args: { path: 'src/core/audit-log.mjs', find: 'x', replace: 'y' }
        }
      ],
      validationCommands: [],
      canaryChecks: []
    });
    expect(out.ok).toBe(false);
    expect(String(out.error || '')).toMatch(/protected_path_requires_elevated_approval/i);
    expect(runtime.calls.length).toBe(0);
  });

  it('allows protected paths with explicit elevated approval', async () => {
    const runtime = createToolRuntime();
    const pipeline = new SelfEditPipeline({
      toolRuntime: runtime,
      memoryStore: createMemoryStore(),
      workspaceRoot: process.cwd(),
      awarenessScorer: () => ({ score: 90, status: 'healthy', issues: [] })
    });
    const out = await pipeline.run({
      goal: 'approved governance doc update',
      edits: [
        {
          tool: 'file_patch',
          args: { path: 'BRAIN.MD', find: 'OpenUnum', replace: 'OpenUnum' }
        }
      ],
      elevatedApproval: {
        approved: true,
        reason: 'operator approved protected path mutation for controlled update'
      },
      validationCommands: [],
      canaryChecks: []
    });
    expect(out.ok).toBe(true);
    expect(out.run.status).toBe('promoted');
    expect(out.run.elevatedApproval?.approved).toBe(true);
  });

  it('rolls back when post-change quality score drops beyond guard', async () => {
    const runtime = createToolRuntime();
    let callCount = 0;
    const pipeline = new SelfEditPipeline({
      toolRuntime: runtime,
      memoryStore: createMemoryStore(),
      workspaceRoot: process.cwd(),
      awarenessScorer: () => {
        callCount += 1;
        if (callCount === 1) return { score: 92, status: 'healthy', issues: [] };
        return { score: 74, status: 'watch', issues: ['quality drop'] };
      }
    });
    const out = await pipeline.run({
      goal: 'quality regression guard test',
      edits: [
        {
          tool: 'file_patch',
          args: { path: 'docs/phasec-quality-gate.md', find: 'a', replace: 'a' }
        }
      ],
      canaryProfile: {
        maxAllowedQualityDrop: 8
      },
      validationCommands: [],
      canaryChecks: []
    });
    expect(out.ok).toBe(false);
    expect(out.run.status).toBe('rolled_back');
    expect(String(out.run.lastError || '')).toMatch(/quality_regression_detected/i);
    expect(out.run.qualityGate?.violated).toBe(true);
    expect(runtime.calls.some((item) => item.name === 'file_restore_last')).toBe(true);
  });
});

