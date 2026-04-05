import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logInfo, logError } from '../../logger.mjs';

const KNOWLEDGE_DIR = 'data/knowledge';

function getKnowledgeDir(workspaceRoot) {
  return path.join(workspaceRoot || process.cwd(), KNOWLEDGE_DIR);
}

function ensureKnowledgeDir(workspaceRoot) {
  const dir = getKnowledgeDir(workspaceRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function loadKnowledgeEntries(workspaceRoot) {
  const dir = getKnowledgeDir(workspaceRoot);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') || f.endsWith('.json')).sort();
  return files.map(f => {
    try {
      const fullPath = path.join(dir, f);
      if (f.endsWith('.json')) {
        return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      }
      // Markdown files — read frontmatter or use filename as title
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      const title = lines[0]?.replace(/^#\s*/, '') || f;
      return {
        id: f.replace(/\.\w+$/, ''),
        title,
        content,
        source: 'file',
        createdAt: fs.statSync(fullPath).birthtime.toISOString()
      };
    } catch { return null; }
  }).filter(Boolean);
}

function saveKnowledgeEntry(entry, workspaceRoot) {
  const dir = ensureKnowledgeDir(workspaceRoot);
  const filename = `${entry.id}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(entry, null, 2));
  return entry;
}

function searchKnowledge(query, entries) {
  const q = query.toLowerCase();
  return entries
    .map(entry => {
      const titleMatch = (entry.title || '').toLowerCase().includes(q) ? 2 : 0;
      const contentMatch = (entry.content || '').toLowerCase().includes(q) ? 1 : 0;
      const score = titleMatch + contentMatch;
      return { ...entry, score };
    })
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);
}

export const knowledgeCommand = {
  name: 'knowledge',
  description: 'Manage searchable knowledge base',
  args: [
    { name: 'action', required: true, description: 'Action: add, list, search, or remove' },
    { name: 'query', required: false, description: 'Search query or entry content' }
  ],
  source: 'builtin/knowledge.mjs',
  examples: [
    'knowledge add Python virtualenv setup',
    'knowledge list',
    'knowledge search virtualenv',
    'knowledge remove abc123'
  ],

  async execute(args, flags, context) {
    const workspaceRoot = context.config?.server?.workspaceRoot || process.cwd();
    const action = (args[0] || '').toLowerCase();

    if (action === 'add') {
      const content = args.slice(1).join(' ').trim();
      if (!content) return 'Usage: /knowledge add <content>';

      // Extract title from first sentence or first 60 chars
      const title = content.split(/[.!?]/)[0].trim().slice(0, 60) || 'Untitled';

      const entry = {
        id: crypto.randomBytes(6).toString('hex'),
        title,
        content,
        createdAt: new Date().toISOString(),
        source: 'user'
      };

      saveKnowledgeEntry(entry, workspaceRoot);
      logInfo('knowledge_added', { id: entry.id, title });

      return [
        `Knowledge entry saved: ${entry.id}`,
        `  Title: "${title}"`,
        `  Content: ${content.slice(0, 200)}${content.length > 200 ? '...' : ''}`
      ].join('\n');
    }

    if (action === 'list') {
      const entries = loadKnowledgeEntries(workspaceRoot);
      if (entries.length === 0) {
        return 'No knowledge entries. Add one with /knowledge add <content>';
      }

      const lines = [`Knowledge base (${entries.length} entries):`];
      entries.forEach((e, i) => {
        lines.push(`  ${i + 1}. [${e.id}] ${e.title}`);
      });

      return lines.join('\n');
    }

    if (action === 'search') {
      const query = args.slice(1).join(' ').trim();
      if (!query) return 'Usage: /knowledge search <query>';

      const entries = loadKnowledgeEntries(workspaceRoot);
      const results = searchKnowledge(query, entries);

      if (results.length === 0) {
        return `No results for "${query}"`;
      }

      const lines = [`Search results for "${query}" (${results.length}):`];
      results.slice(0, 5).forEach((e, i) => {
        lines.push(`  ${i + 1}. [${e.id}] ${e.title}`);
        lines.push(`     ${String(e.content || '').slice(0, 150)}...`);
      });

      return lines.join('\n');
    }

    if (action === 'remove') {
      const targetId = (args[1] || '').trim();
      if (!targetId) return 'Usage: /knowledge remove <entry-id>';

      const dir = getKnowledgeDir(workspaceRoot);
      const filePath = path.join(dir, `${targetId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logInfo('knowledge_removed', { id: targetId });
        return `Knowledge entry ${targetId} removed.`;
      }
      return `Knowledge entry ${targetId} not found.`;
    }

    return 'Usage: /knowledge add <content> | /knowledge list | /knowledge search <query> | /knowledge remove <id>';
  }
};

export default knowledgeCommand;
