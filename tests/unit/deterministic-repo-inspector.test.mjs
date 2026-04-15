import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { file_grep, file_search } from '../../src/tools/file-search.mjs';
import {
  classifyDeterministicRepoInspection,
  runDeterministicRepoInspection
} from '../../src/core/deterministic-repo-inspector.mjs';

const tmpRoots = [];

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-repo-fast-'));
  tmpRoots.push(root);
  fs.mkdirSync(path.join(root, 'src/core'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/memory'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/server/routes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/providers'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/models'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/skills'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/tools/backends'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/ui/modules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/archive'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/core/agent.mjs'), 'export class OpenUnumAgent {}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/core/autonomy-nudges.mjs'), 'export const nudge = "meta_harness_review";\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/core/missions.mjs'), 'export function listMissions() { return []; }\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/memory/store.mjs'), 'export class MemoryStore {}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/memory/recall.mjs'), 'export function recallMemory() { return []; }\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/memory/freshness-decay.mjs'), 'export function scoreFreshness() { return 1; }\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/server/routes/missions.mjs'), 'export function mountMissionsRoutes() {}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/providers/index.mjs'), 'export function listProviders() { return []; }\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/providers/ollama.mjs'), 'export function createOllamaProvider() {}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/models/catalog.mjs'), 'export const catalog = [];\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/skills/manager.mjs'), 'export function listSkills() { return []; }\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/skills/loader.mjs'), 'export function loadSkills() { return []; }\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/skills/builtin.mjs'), 'export const builtinSkills = [];\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/tools/runtime.mjs'), 'export function createToolRuntime() {}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/tools/tool-contracts.mjs'), 'export const toolContracts = [];\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/tools/backends/registry.mjs'), 'export const backendRegistry = [];\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/ui/modules/missions.js'), 'export function renderMissionsView() {}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/ui/modules/provider-vault.js'), 'export function renderProviderVault() {}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/ui/modules/model-routing.js'), 'export function renderModelRouting() {}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/ui/modules/routing-ui-helpers.js'), 'export function getRoutingState() {}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs/AGENT_ONBOARDING.md'), '# Agent Onboarding\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs/archive/agent-onboarding.md'), '# Archived Agent Onboarding\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs/CHANGELOG_CURRENT.md'), '# Current Changelog\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs/INDEX.md'), '# Docs Index\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs/MEMORY_SYSTEM.md'), '# Memory System\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs/AUTONOMY_AND_MEMORY.md'), '# Autonomy and Memory\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs/UI_BEHAVIOR.md'), '# UI Behavior\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs/CODEBASE_MAP.md'), '# Codebase Map\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs/SKILL_BUNDLES.md'), '# Skill Bundles\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs/MODEL_BACKED_TOOLS.md'), '# Model Backed Tools\n', 'utf8');
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Historical Changelog\n', 'utf8');
  fs.writeFileSync(path.join(root, 'README.md'), '# README\n', 'utf8');
  fs.writeFileSync(path.join(root, 'tests/noisy.test.mjs'), 'meta harness from noisy test evidence\n', 'utf8');
  return root;
}

async function runLocalTool(name, args) {
  if (name === 'file_search') return file_search(args);
  if (name === 'file_grep') return file_grep(args);
  if (name === 'file_read') {
    return {
      ok: true,
      path: args.path,
      content: fs.readFileSync(args.path, 'utf8')
    };
  }
  throw new Error(`unsupported tool ${name}`);
}

afterEach(() => {
  while (tmpRoots.length) {
    const root = tmpRoots.pop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('deterministic repo inspector', () => {
  it('classifies repo explanation prompts as eligible', () => {
    const out = classifyDeterministicRepoInspection('How is meta harness is working for openunum ?');
    expect(out.eligible).toBe(true);
    expect(out.anchors).toContain('harness');
  });

  it('rejects execution tasks', () => {
    const out = classifyDeterministicRepoInspection('fix the onboarding docs and update the code');
    expect(out.eligible).toBe(false);
  });

  it('rejects broad product-improvement brainstorming prompts', () => {
    const out = classifyDeterministicRepoInspection('What we can improve in for openunum ? What do you think ?');
    expect(out.eligible).toBe(false);
  });

  it('classifies memory/provider/tool review prompts as eligible', () => {
    expect(classifyDeterministicRepoInspection('How is memory working for openunum ?')).toMatchObject({
      eligible: true,
      anchors: expect.arrayContaining(['memory'])
    });
    expect(classifyDeterministicRepoInspection('Review providers and model routing in openunum')).toMatchObject({
      eligible: true,
      anchors: expect.arrayContaining(['providers', 'routing'])
    });
    expect(classifyDeterministicRepoInspection('Check tools and skills in openunum')).toMatchObject({
      eligible: true,
      anchors: expect.arrayContaining(['tools', 'skills'])
    });
    expect(classifyDeterministicRepoInspection('Inspect missions in the openunum repo')).toMatchObject({
      eligible: true,
      anchors: expect.arrayContaining(['missions'])
    });
  });

  it('produces a direct harness answer from local repo evidence', async () => {
    const workspaceRoot = makeWorkspace();
    const out = await runDeterministicRepoInspection({
      message: 'How is meta harness is working for openunum ?',
      workspaceRoot,
      runTool: runLocalTool
    });
    expect(out.reply).toContain('meta harness');
    expect(out.reply).not.toContain('Status: ok');
    expect(out.executedTools.length).toBeGreaterThan(0);
  });

  it('produces a direct code/doc review answer from canonical docs and archive evidence', async () => {
    const workspaceRoot = makeWorkspace();
    const out = await runDeterministicRepoInspection({
      message: 'Check your code and latest changelogs , also agentonboarding and tell me if all make sense for you , you think we miss something , or something is not linked to code or used ?',
      workspaceRoot,
      runTool: runLocalTool
    });
    expect(out.reply).toContain('retrieval drift');
    expect(out.reply).not.toContain('Status: ok');
  });

  it('answers memory reviews from direct repo evidence', async () => {
    const workspaceRoot = makeWorkspace();
    const out = await runDeterministicRepoInspection({
      message: 'How is memory working for openunum ?',
      workspaceRoot,
      runTool: runLocalTool
    });
    expect(out.reply).toContain('I checked');
    expect(out.reply).toContain('/src/memory/store.mjs');
    expect(out.reply).toContain('/docs/MEMORY_SYSTEM.md');
    expect(out.executedTools.some((run) => run?.name === 'file_read' && /src\/memory\/store\.mjs$/.test(run?.result?.path || ''))).toBe(true);
  });

  it('answers provider and routing reviews without falling back to status output', async () => {
    const workspaceRoot = makeWorkspace();
    const out = await runDeterministicRepoInspection({
      message: 'Review providers and model routing in openunum',
      workspaceRoot,
      runTool: runLocalTool
    });
    expect(out.reply).toContain('I checked implementation files');
    expect(out.reply).toContain('/src/providers/index.mjs');
    expect(out.reply).toContain('/src/ui/modules/model-routing.js');
    expect(out.reply).not.toContain('Status: ok');
  });

  it('answers tools and skills reviews without falling back to status output', async () => {
    const workspaceRoot = makeWorkspace();
    const out = await runDeterministicRepoInspection({
      message: 'Check tools and skills in openunum',
      workspaceRoot,
      runTool: runLocalTool
    });
    expect(out.reply).toContain('I checked implementation files');
    expect(out.reply).toContain('/src/skills/loader.mjs');
    expect(out.reply).toContain('/src/tools/runtime.mjs');
    expect(out.reply).not.toContain('Status: ok');
  });

  it('prunes noisy self or test evidence from the synthesized reply', async () => {
    const workspaceRoot = makeWorkspace();
    const out = await runDeterministicRepoInspection({
      message: 'How is meta harness is working for openunum ?',
      workspaceRoot,
      runTool: runLocalTool
    });
    expect(out.reply).not.toContain('deterministic-repo-inspector.mjs');
    expect(out.reply).not.toContain('turn-recovery-summary.mjs');
    expect(out.reply).not.toContain('noisy.test.mjs');
    expect(out.executedTools.every((run) => {
      if (run?.name === 'file_read') return !/\/tests\//.test(run?.result?.path || '');
      if (run?.name === 'file_search') return !(run?.result?.files || []).some((filePath) => /\/tests\//.test(filePath));
      if (run?.name === 'file_grep') return !(run?.result?.matches || []).some((item) => /\/tests\//.test(item?.file || ''));
      return true;
    })).toBe(true);
  });
});
