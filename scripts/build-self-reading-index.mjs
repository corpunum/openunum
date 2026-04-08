#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'docs', 'SELF_READING_INDEX.md');

const SECTIONS = [
  {
    title: 'Core Runtime',
    paths: [
      'src/core/agent.mjs',
      'src/core/context-compiler.mjs',
      'src/core/working-memory.mjs',
      'src/core/role-mode-router.mjs',
      'src/core/self-heal-orchestrator.mjs'
    ]
  },
  {
    title: 'Server Surface',
    paths: [
      'src/server.mjs',
      'src/server/routes/health.mjs',
      'src/server/services/auth_service.mjs'
    ]
  },
  {
    title: 'Security and Secrets',
    paths: [
      'src/secrets/store.mjs',
      'docs/CONFIG_SCHEMA.md',
      'docs/API_REFERENCE.md'
    ]
  },
  {
    title: 'Testing and Gates',
    paths: [
      'docs/TESTING.md',
      'scripts/docs-completion-gate.mjs',
      'scripts/smoke-isolated.mjs',
      'scripts/session-imitation-regression.mjs'
    ]
  },
  {
    title: 'Operations and Roadmap',
    paths: [
      'README.md',
      'BRAIN.MD',
      'docs/AGENT_ONBOARDING.md',
      'docs/ROADMAP.md',
      'CHANGELOG.md'
    ]
  }
];

function fileLineCount(filePath) {
  try {
    const content = fs.readFileSync(path.join(ROOT, filePath), 'utf8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

function build() {
  const lines = [];
  lines.push('# Self Reading Index');
  lines.push('');
  lines.push('Purpose: curated file map for autonomous code/docs self-reading and update workflows.');
  lines.push('');

  for (const section of SECTIONS) {
    lines.push(`## ${section.title}`);
    lines.push('');
    for (const rel of section.paths) {
      const abs = path.join(ROOT, rel);
      const exists = fs.existsSync(abs);
      const count = exists ? fileLineCount(rel) : 0;
      lines.push(`- ${exists ? '✅' : '❌'} \`${rel}\` (${count} lines)`);
    }
    lines.push('');
  }

  fs.writeFileSync(OUTPUT, `${lines.join('\n')}\n`, 'utf8');
  console.log(`wrote ${OUTPUT}`);
}

build();
