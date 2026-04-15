import fs from 'node:fs';
import path from 'node:path';
import {
  assessFinalAnswerQuality,
  extractRequirements,
  synthesizeToolOnlyAnswer
} from './turn-recovery-summary.mjs';

const STOP_WORDS = new Set([
  'about',
  'again',
  'agent',
  'all',
  'also',
  'and',
  'any',
  'around',
  'best',
  'check',
  'code',
  'current',
  'does',
  'docs',
  'documentation',
  'for',
  'from',
  'have',
  'how',
  'into',
  'is',
  'it',
  'latest',
  'linked',
  'make',
  'me',
  'miss',
  'not',
  'openunum',
  'or',
  'something',
  'tell',
  'that',
  'the',
  'this',
  'think',
  'used',
  'working',
  'you',
  'your'
]);

const NOISY_EVIDENCE_PATTERNS = [
  /\/tests\//i,
  /\/scripts\//i,
  /\/src\/core\/deterministic-repo-inspector\.mjs$/i,
  /\/src\/core\/turn-recovery-summary\.mjs$/i
];

const ANCHOR_DEFS = [
  {
    key: 'harness',
    detect: /\bharness\b|meta[\s_-]*harness/i,
    grepTerms: ['meta.*harness|harness.*meta', 'harness'],
    searchTerms: ['harness'],
    readCandidates: [
      'src/core/autonomy-nudges.mjs',
      'docs/MODEL_AWARE_CONTROLLER.md'
    ]
  },
  {
    key: 'onboarding',
    detect: /\b(agentonboarding|agent onboarding|onboard|onboarding)\b/i,
    grepTerms: [],
    searchTerms: [],
    readCandidates: [
      'docs/AGENT_ONBOARDING.md',
      'docs/INDEX.md',
      'docs/archive/agent-onboarding.md'
    ]
  },
  {
    key: 'changelog',
    detect: /\bchangelogs?\b/i,
    grepTerms: [],
    searchTerms: [],
    readCandidates: [
      'docs/CHANGELOG_CURRENT.md',
      'CHANGELOG.md'
    ]
  },
  {
    key: 'docs',
    detect: /\bdocs?\b|\bdocumentation\b/i,
    grepTerms: [],
    searchTerms: [],
    readCandidates: [
      'docs/INDEX.md',
      'README.md'
    ]
  },
  {
    key: 'code',
    detect: /\bcode\b|\bcodebase\b|\blinked to code\b|\bused\b|\bmake sense\b/i,
    grepTerms: [],
    searchTerms: ['agent'],
    readCandidates: [
      'src/core/agent.mjs',
      'README.md'
    ]
  },
  {
    key: 'memory',
    detect: /\b(memory|memories|recall|retrieval|freshness|embedding(?:s)?)\b/i,
    grepTerms: [],
    searchTerms: [],
    readCandidates: [
      'src/memory/store.mjs',
      'src/memory/recall.mjs',
      'src/memory/freshness-decay.mjs',
      'docs/MEMORY_SYSTEM.md',
      'docs/AUTONOMY_AND_MEMORY.md'
    ]
  },
  {
    key: 'missions',
    detect: /\bmission(?:s)?\b/i,
    grepTerms: [],
    searchTerms: [],
    readCandidates: [
      'src/core/missions.mjs',
      'src/server/routes/missions.mjs',
      'src/ui/modules/missions.js',
      'docs/UI_BEHAVIOR.md'
    ]
  },
  {
    key: 'providers',
    detect: /\bprovider(?:s)?\b|\bprovider vault\b/i,
    grepTerms: [],
    searchTerms: [],
    readCandidates: [
      'src/providers/index.mjs',
      'src/providers/ollama.mjs',
      'src/ui/modules/provider-vault.js',
      'docs/CODEBASE_MAP.md'
    ]
  },
  {
    key: 'routing',
    detect: /\bmodel routing\b|\brouting\b/i,
    grepTerms: [],
    searchTerms: [],
    readCandidates: [
      'src/models/catalog.mjs',
      'src/ui/modules/model-routing.js',
      'src/ui/modules/routing-ui-helpers.js',
      'docs/CODEBASE_MAP.md'
    ]
  },
  {
    key: 'skills',
    detect: /\bskill(?:s)?\b/i,
    grepTerms: [],
    searchTerms: [],
    readCandidates: [
      'src/skills/manager.mjs',
      'src/skills/loader.mjs',
      'src/skills/builtin.mjs',
      'docs/SKILL_BUNDLES.md'
    ]
  },
  {
    key: 'tools',
    detect: /\btool(?:s)?\b|\btooling\b/i,
    grepTerms: [],
    searchTerms: [],
    readCandidates: [
      'src/tools/runtime.mjs',
      'src/tools/tool-contracts.mjs',
      'src/tools/backends/registry.mjs',
      'docs/MODEL_BACKED_TOOLS.md'
    ]
  }
];

function normalizeMessage(message = '') {
  return String(message || '')
    .toLowerCase()
    .replace(/[^\w\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniq(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function isNoisyEvidencePath(filePath = '') {
  const normalized = String(filePath || '').trim();
  if (!normalized) return true;
  return NOISY_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasExecutionIntent(message = '') {
  return /\b(fix|implement|build|create|write|edit|refactor|run|execute|install|remove|delete|update|change|test|verify|deploy)\b/i.test(String(message || ''));
}

function isImprovementProposalPrompt(message = '') {
  const text = String(message || '');
  return (
    /\bopenunum\b/i.test(text) &&
    (
      /\bwhat\b[\s\S]{0,80}\b(improve|improvement|better|enhance|missing|miss|change|add|remove|correct)\b/i.test(text) ||
      /\bwhat do you think\b/i.test(text)
    ) &&
    !/\b(check|review|inspect|read|audit|understand)\b/i.test(text)
  );
}

function extractSubjectTerms(message = '') {
  const normalized = normalizeMessage(message);
  const matches = [
    normalized.match(/\bhow is (.+?) working\b/),
    normalized.match(/\bhow does (.+?) work\b/),
    normalized.match(/\bwhat is (.+?)\b/)
  ].filter(Boolean);
  const raw = matches[0]?.[1] || '';
  if (!raw) return [];
  return uniq(
    raw
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 4 && !STOP_WORDS.has(term))
      .slice(0, 3)
  );
}

function detectAnchors(message = '') {
  return ANCHOR_DEFS.filter((anchor) => anchor.detect.test(String(message || '')));
}

function fileSearchPattern(term = '') {
  const safe = String(term || '').replace(/[^a-z0-9_-]/gi, '');
  if (!safe) return '';
  return `**/*${safe}*`;
}

function absoluteExistingPaths(workspaceRoot, relativePaths = []) {
  return relativePaths
    .map((rel) => path.join(workspaceRoot, rel))
    .filter((abs) => fs.existsSync(abs));
}

function buildInitialTasks({ message = '', workspaceRoot = '' }) {
  const anchors = detectAnchors(message);
  const hasDiscoveryAnchors = anchors.some((anchor) => (anchor.grepTerms || []).length || (anchor.searchTerms || []).length);
  const subjectTerms = extractSubjectTerms(message);
  const searchTerms = uniq([
    ...anchors.flatMap((anchor) => anchor.searchTerms || []),
    ...(hasDiscoveryAnchors ? subjectTerms : [])
  ]).slice(0, 4);
  const grepTerms = uniq([
    ...anchors.flatMap((anchor) => anchor.grepTerms || []),
    ...(hasDiscoveryAnchors ? subjectTerms : [])
  ]).slice(0, 4);
  const directReads = uniq(absoluteExistingPaths(
    workspaceRoot,
    uniq([
      ...anchors.flatMap((anchor) => anchor.readCandidates || []),
      'src/core/agent.mjs',
      'docs/INDEX.md'
    ])
  )).filter((filePath) => !isNoisyEvidencePath(filePath)).slice(0, 6);

  const tasks = [];
  for (const term of grepTerms) {
    tasks.push({
      name: 'file_grep',
      args: {
        search: term,
        pattern: '*.mjs',
        root: workspaceRoot,
        caseSensitive: false
      }
    });
  }
  for (const term of searchTerms) {
    const pattern = fileSearchPattern(term);
    if (!pattern) continue;
    tasks.push({
      name: 'file_search',
      args: {
        pattern,
        root: workspaceRoot,
        recursive: true
      }
    });
  }
  for (const filePath of directReads) {
    tasks.push({
      name: 'file_read',
      args: {
        path: filePath
      }
    });
  }

  const seen = new Set();
  return tasks.filter((task) => {
    const key = `${task.name}:${JSON.stringify(task.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

function collectMatchedPaths(executedTools = []) {
  const paths = [];
  for (const run of executedTools) {
    if (!run?.result?.ok) continue;
    if (run?.name === 'file_search' && Array.isArray(run?.result?.files)) {
      paths.push(...run.result.files);
    }
    if (run?.name === 'file_grep' && Array.isArray(run?.result?.matches)) {
      paths.push(...run.result.matches.map((item) => item?.file));
    }
    if (run?.name === 'file_read' && run?.result?.path) {
      paths.push(run.result.path);
    }
  }
  return uniq(paths.filter(Boolean).filter((filePath) => !isNoisyEvidencePath(filePath)));
}

function filterExecutedToolEvidence(executedTools = []) {
  return executedTools
    .map((run) => {
      if (!run || typeof run !== 'object') return null;
      if (run?.name === 'file_search' && Array.isArray(run?.result?.files)) {
        const files = run.result.files.filter((filePath) => !isNoisyEvidencePath(filePath));
        if (!files.length) return null;
        return {
          ...run,
          result: {
            ...run.result,
            files
          }
        };
      }
      if (run?.name === 'file_grep' && Array.isArray(run?.result?.matches)) {
        const matches = run.result.matches.filter((item) => !isNoisyEvidencePath(item?.file));
        if (!matches.length) return null;
        return {
          ...run,
          result: {
            ...run.result,
            matches
          }
        };
      }
      if (run?.name === 'file_read' && isNoisyEvidencePath(run?.result?.path)) return null;
      return run;
    })
    .filter(Boolean);
}

function prioritizeReadTargets({ message = '', workspaceRoot = '', executedTools = [] }) {
  const anchors = detectAnchors(message);
  const directCandidates = absoluteExistingPaths(workspaceRoot, anchors.flatMap((anchor) => anchor.readCandidates || []));
  const matched = collectMatchedPaths(executedTools)
    .filter((item) => String(item || '').startsWith(workspaceRoot))
    .filter((item) => /\.(mjs|js|md)$/i.test(String(item || '')));

  const scored = uniq([...directCandidates, ...matched])
    .filter((item) => !isNoisyEvidencePath(item))
    .map((item) => {
      let score = 0;
      if (/src\/core\//.test(item)) score += 4;
      if (/src\/memory\//.test(item)) score += 5;
      if (/src\/providers\//.test(item)) score += 5;
      if (/src\/skills\//.test(item)) score += 5;
      if (/src\/tools\//.test(item)) score += 5;
      if (/src\/server\/routes\//.test(item)) score += 4;
      if (/src\/ui\/modules\//.test(item)) score += 3;
      if (/docs\//.test(item)) score += 3;
      if (/README\.md$/.test(item) || /CHANGELOG/i.test(item)) score += 3;
      if (/autonomy-nudges\.mjs$/.test(item)) score += 6;
      if (/AGENT_ONBOARDING\.md$/.test(item)) score += 6;
      if (/CHANGELOG_CURRENT\.md$/.test(item)) score += 5;
      if (/MEMORY_SYSTEM\.md$/.test(item)) score += 6;
      if (/AUTONOMY_AND_MEMORY\.md$/.test(item)) score += 5;
      if (/missions\.mjs$/i.test(item)) score += 5;
      if (/provider-vault\.js$/i.test(item)) score += 4;
      if (/model-routing\.js$/i.test(item)) score += 4;
      if (/SKILL_BUNDLES\.md$/i.test(item)) score += 5;
      if (/MODEL_BACKED_TOOLS\.md$/i.test(item)) score += 5;
      return { path: item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.path);

  return scored.slice(0, 5);
}

export function classifyDeterministicRepoInspection(message = '') {
  const requirements = extractRequirements(message);
  const text = String(message || '');
  const anchors = detectAnchors(text);
  const repoSignals = /\b(openunum|repo(?:sitory)?|code(?:base)?|docs?|documentation|onboard(?:ing)?|agentonboarding|changelog|harness|memory|mission(?:s)?|provider(?:s)?|routing|skill(?:s)?|tool(?:s)?|linked to code|used)\b/i.test(text);
  const anchorReviewIntent = /\b(check|review|audit|inspect|read|understand)\b/i.test(text) && anchors.length > 0;
  const analysisIntent = requirements.asksExplanation || requirements.asksReview || anchorReviewIntent;
  const eligible =
    analysisIntent &&
    repoSignals &&
    !isImprovementProposalPrompt(text) &&
    !requirements.asksResearch &&
    !requirements.asksDataset &&
    !requirements.asksDocumentDiscussion &&
    !requirements.asksRanking &&
    !hasExecutionIntent(text);
  return {
    eligible,
    requirements,
    anchors: anchors.map((anchor) => anchor.key),
    subjectTerms: extractSubjectTerms(text)
  };
}

export async function runDeterministicRepoInspection({
  message = '',
  workspaceRoot = '',
  runTool
} = {}) {
  const classification = classifyDeterministicRepoInspection(message);
  if (!classification.eligible || typeof runTool !== 'function') return null;

  const executedTools = [];
  const iterations = [];
  const deadlineAt = Date.now() + 12000;
  const firstWave = buildInitialTasks({ message, workspaceRoot });
  const firstIter = { step: 1, toolCalls: [], assistantText: 'Deterministic repo inspection' };

  for (const task of firstWave) {
    const result = await runTool(task.name, task.args, { deadlineAt });
    executedTools.push({ name: task.name, args: task.args, result });
    firstIter.toolCalls.push({ name: task.name, args: task.args, result });
  }
  if (firstIter.toolCalls.length) iterations.push(firstIter);

  const readTargets = prioritizeReadTargets({ message, workspaceRoot, executedTools })
    .filter((filePath) => !executedTools.some((run) => run?.name === 'file_read' && run?.args?.path === filePath));
  if (readTargets.length) {
    const secondIter = { step: 2, toolCalls: [], assistantText: '' };
    for (const filePath of readTargets) {
      const result = await runTool('file_read', { path: filePath }, { deadlineAt });
      executedTools.push({ name: 'file_read', args: { path: filePath }, result });
      secondIter.toolCalls.push({ name: 'file_read', args: { path: filePath }, result });
    }
    if (secondIter.toolCalls.length) iterations.push(secondIter);
  }

  const filteredExecutedTools = filterExecutedToolEvidence(executedTools);
  const reply = synthesizeToolOnlyAnswer({
    userMessage: message,
    executedTools: filteredExecutedTools,
    toolRuns: filteredExecutedTools.length
  });
  const answerAssessment = assessFinalAnswerQuality({
    finalText: reply,
    userMessage: message,
    executedTools: filteredExecutedTools,
    toolRuns: filteredExecutedTools.length
  });
  if (!reply || answerAssessment.shouldReplace) return null;

  return {
    reply,
    executedTools: filteredExecutedTools,
    iterations,
    answerAssessment,
    classification
  };
}
