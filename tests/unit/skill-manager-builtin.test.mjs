import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const originalHome = process.env.OPENUNUM_HOME;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-builtin-skill-'));
process.env.OPENUNUM_HOME = testHome;

afterAll(() => {
  if (originalHome == null) delete process.env.OPENUNUM_HOME;
  else process.env.OPENUNUM_HOME = originalHome;
  fs.rmSync(testHome, { recursive: true, force: true });
});

describe('SkillManager builtin skills', () => {
  it('lists repo builtin skills alongside managed skills', async () => {
    const { SkillManager } = await import('../../src/skills/manager.mjs');
    const manager = new SkillManager();
    const skills = manager.listSkills();
    expect(skills.some((row) => row.name === 'unum-council' && row.source === 'builtin')).toBe(true);
  });

  it('executes unum-council in dry-run mode without provider calls', async () => {
    const { SkillManager } = await import('../../src/skills/manager.mjs');
    const manager = new SkillManager();
    const out = await manager.executeSkill('unum-council', {
      request: 'Debate whether OpenUnum should use a council for architectural decisions.',
      dryRun: true
    });
    assert.equal(out.ok, true);
    assert.equal(out.name, 'unum-council');
    assert.equal(out.result?.dryRun, true);
    assert.equal(Array.isArray(out.result?.council), true);
    assert.equal(out.result.council.length > 0, true);
  });
});
