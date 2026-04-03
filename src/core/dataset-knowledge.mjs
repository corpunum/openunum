import fs from 'node:fs';
import path from 'node:path';

let cache = null;

function lower(value) {
  return String(value || '').toLowerCase();
}

function scoreHints(id = '', tags = [], description = '') {
  const text = `${id} ${(tags || []).join(' ')} ${description}`.toLowerCase();
  return {
    toolCalling: /tool-calling|tool calling|function-calling|function calling|mcp|tool use/.test(text),
    planning: /planner|planning|task|workflow|multi-step|trajectory/.test(text),
    evaluation: /benchmark|eval|evaluation/.test(text)
  };
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadKnowledge() {
  if (cache) return cache;
  const root = process.cwd();
  const explorationPath = path.join(root, 'docs', 'research', 'hf_dataset_exploration_2026-04-03.json');
  const pilotManifestPath = path.join(root, 'data', 'hf-pilot', 'manifest.json');

  const exploration = readJsonSafe(explorationPath);
  const pilotManifest = readJsonSafe(pilotManifestPath);

  const top = Array.isArray(exploration?.top) ? exploration.top : [];
  const pilotDatasets = Array.isArray(pilotManifest?.pilotDatasets) ? pilotManifest.pilotDatasets : [];

  const map = new Map();
  for (let i = 0; i < top.length; i += 1) {
    const row = top[i];
    const id = String(row?.id || '').trim();
    if (!id) continue;
    map.set(id.toLowerCase(), {
      id,
      rank: i + 1,
      score: Number(row?.score || 0),
      downloads: Number(row?.downloads || 0),
      likes: Number(row?.likes || 0),
      license: String(row?.license || ''),
      tags: Array.isArray(row?.tags) ? row.tags.map((tag) => String(tag)) : [],
      description: String(row?.description || ''),
      inPilot: pilotDatasets.some((item) => String(item?.id || '').toLowerCase() === id.toLowerCase()),
      hints: scoreHints(id, row?.tags || [], row?.description || '')
    });
  }

  cache = {
    generatedAt: String(exploration?.generatedAt || pilotManifest?.stats?.generatedAt || ''),
    top,
    pilotDatasets,
    byId: map,
    hasKnowledge: map.size > 0
  };
  return cache;
}

export function getDatasetKnowledge() {
  return loadKnowledge();
}

export function scoreDatasetWithKnowledgeBoost(item) {
  const knowledge = loadKnowledge();
  const id = lower(item?.id || '');
  const known = knowledge.byId.get(id);
  if (!known) {
    return {
      rankBoost: 0,
      pilotBoost: 0,
      hintBoost: 0,
      totalBoost: 0,
      known: null
    };
  }

  const rank = Number(known.rank || 999);
  const rankBoost = Math.max(0, 32 - Math.min(rank, 30));
  const pilotBoost = known.inPilot ? 24 : 0;
  const hintBoost =
    (known.hints.toolCalling ? 14 : 0) +
    (known.hints.planning ? 10 : 0) +
    (known.hints.evaluation ? 8 : 0);

  return {
    rankBoost,
    pilotBoost,
    hintBoost,
    totalBoost: rankBoost + pilotBoost + hintBoost,
    known
  };
}
