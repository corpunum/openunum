import fs from 'node:fs';
import path from 'node:path';
import { ensureHome, getHomeDir } from '../config.mjs';

function nowIso() {
  return new Date().toISOString();
}

function toFilenameDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function extractLinks(html, limit = 6) {
  const out = [];
  const re = /https?:\/\/[^\s"'<>]+/g;
  const seen = new Set();
  for (const m of String(html || '').matchAll(re)) {
    const url = String(m[0]).replace(/[),.;]+$/, '');
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export class ResearchManager {
  constructor({ config }) {
    ensureHome();
    this.config = config;
    this.homeDir = getHomeDir();
    this.researchDir = path.join(this.homeDir, 'research');
    this.reviewQueuePath = path.join(this.researchDir, 'review-queue.json');
    fs.mkdirSync(this.researchDir, { recursive: true });
    if (!fs.existsSync(this.reviewQueuePath)) {
      fs.writeFileSync(this.reviewQueuePath, JSON.stringify({ proposals: [], updatedAt: nowIso() }, null, 2), 'utf8');
    }
  }

  loadQueue() {
    return JSON.parse(fs.readFileSync(this.reviewQueuePath, 'utf8'));
  }

  saveQueue(queue) {
    queue.updatedAt = nowIso();
    fs.writeFileSync(this.reviewQueuePath, JSON.stringify(queue, null, 2), 'utf8');
  }

  async searchQuery(query, limitPerQuery = 5) {
    const q = encodeURIComponent(query);
    const url = `https://duckduckgo.com/html/?q=${q}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'OpenUnum Research Bot/1.0' } });
      if (!res.ok) return { ok: false, query, error: `http_${res.status}`, links: [] };
      const html = await res.text();
      const links = extractLinks(html, limitPerQuery);
      return { ok: true, query, url, links };
    } catch (error) {
      return { ok: false, query, error: String(error.message || error), links: [] };
    }
  }

  async runDailyResearch({ simulate = false } = {}) {
    const queries = Array.isArray(this.config.research?.defaultQueries) && this.config.research.defaultQueries.length
      ? this.config.research.defaultQueries
      : [
        'advanced autonomous agents reddit',
        'agent engineering X twitter',
        'google workspace agent automation',
        'self-healing ai agents github'
      ];
    const results = [];
    for (const query of queries) {
      if (simulate) {
        results.push({
          ok: true,
          query,
          links: [
            `https://example.org/research/${encodeURIComponent(query)}`,
            `https://example.org/review/${encodeURIComponent(query)}`
          ]
        });
        continue;
      }
      // keep sequential to reduce burst failures
      // eslint-disable-next-line no-await-in-loop
      const out = await this.searchQuery(query, 5);
      results.push(out);
    }

    const findings = results.flatMap((r) => (r.links || []).map((u) => ({
      sourceQuery: r.query,
      url: u,
      status: 'pending_review',
      discoveredAt: nowIso()
    })));
    const report = {
      date: toFilenameDate(),
      timestamp: nowIso(),
      simulate: Boolean(simulate),
      queries,
      results,
      findingsCount: findings.length,
      reviewRequired: true
    };

    const filePath = path.join(this.researchDir, `research-${toFilenameDate()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');

    const queue = this.loadQueue();
    queue.proposals = [...queue.proposals, ...findings].slice(-500);
    this.saveQueue(queue);

    return {
      ok: true,
      filePath,
      findingsCount: findings.length,
      failedQueries: results.filter((r) => !r.ok).length
    };
  }

  listRecent(limit = 10) {
    const entries = fs.readdirSync(this.researchDir)
      .filter((f) => /^research-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => {
        const p = path.join(this.researchDir, f);
        const stat = fs.statSync(p);
        return { file: f, path: p, mtime: stat.mtime.toISOString(), bytes: stat.size };
      });
    return { ok: true, entries };
  }

  reviewQueue(limit = 50) {
    const queue = this.loadQueue();
    return {
      ok: true,
      total: queue.proposals.length,
      proposals: queue.proposals.slice(-limit)
    };
  }

  approveProposal(url, note = '') {
    const queue = this.loadQueue();
    const item = queue.proposals.find((p) => p.url === url);
    if (!item) return { ok: false, error: 'proposal_not_found' };
    item.status = 'approved';
    item.approvedAt = nowIso();
    item.note = note;
    this.saveQueue(queue);
    return { ok: true, url, status: 'approved' };
  }
}

