/**
 * Hierarchical Policy Loader
 * 
 * Loads AGENTS.md files in tiered precedence:
 * 1. session/AGENTS.md (highest priority)
 * 2. project/AGENTS.md
 * 3. root AGENTS.md (lowest priority, global defaults)
 * 
 * Higher tiers override lower tiers on conflicts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logInfo, logError } from '../logger.mjs';

export class PolicyLoader {
  constructor({ workspaceRoot }) {
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.cache = null;
    this.lastLoad = null;
  }

  /**
   * Load all policy tiers and merge with precedence
   */
  async loadPolicies(sessionId = null) {
    const tiers = [
      { name: 'global', path: path.join(this.workspaceRoot, 'AGENTS.md') },
      { name: 'project', path: path.join(this.workspaceRoot, 'project', 'AGENTS.md') },
      { name: 'session', path: path.join(this.workspaceRoot, 'sessions', sessionId, 'AGENTS.md') }
    ];

    const policies = [];
    const metadata = {
      loadedTiers: [],
      loadTime: Date.now(),
      conflicts: []
    };

    for (const tier of tiers) {
      try {
        if (fs.existsSync(tier.path)) {
          const content = fs.readFileSync(tier.path, 'utf-8');
          const parsed = this._parsePolicy(content, tier.name);
          policies.push(parsed);
          metadata.loadedTiers.push(tier.name);
          logInfo('policy_tier_loaded', { tier: tier.name, path: tier.path });
        } else {
          logInfo('policy_tier_missing', { tier: tier.name, path: tier.path });
        }
      } catch (error) {
        logError('policy_load_error', { tier: tier.name, error: String(error.message || error) });
      }
    }

    // Merge with precedence (later tiers override earlier)
    const merged = this._mergePolicies(policies, metadata);
    this.cache = { merged, metadata };
    this.lastLoad = Date.now();

    return { policies: merged, metadata };
  }

  /**
   * Parse policy file into structured sections
   */
  _parsePolicy(content, tier) {
    const sections = {};
    const currentSection = { name: 'preamble', content: [] };
    
    const lines = content.split('\n');
    for (const line of lines) {
      // Section headers: ## Section Name
      const headerMatch = line.match(/^##\s+(.+)$/);
      if (headerMatch) {
        if (currentSection.content.length > 0) {
          sections[currentSection.name] = currentSection.content.join('\n').trim();
        }
        currentSection.name = headerMatch[1].toLowerCase().replace(/\s+/g, '_');
        currentSection.content = [];
      } else {
        currentSection.content.push(line);
      }
    }

    // Don't forget the last section
    if (currentSection.content.length > 0) {
      sections[currentSection.name] = currentSection.content.join('\n').trim();
    }

    return { tier, sections };
  }

  /**
   * Merge policies with precedence tracking
   */
  _mergePolicies(policies, metadata) {
    const merged = {
      preamble: '',
      sections: {},
      fullText: ''
    };

    const sectionSources = {};

    for (const policy of policies) {
      // Preamble accumulates (all tiers contribute)
      if (policy.sections.preamble) {
        merged.preamble += `\n\n[${policy.tier}] ${policy.sections.preamble}`;
      }

      // Sections: later tier overrides
      for (const [name, content] of Object.entries(policy.sections)) {
        if (name === 'preamble') continue;
        
        if (merged.sections[name]) {
          // Track conflict
          metadata.conflicts.push({
            section: name,
            overriddenBy: policy.tier,
            previousTier: sectionSources[name]
          });
        }
        
        merged.sections[name] = content;
        sectionSources[name] = policy.tier;
      }
    }

    // Build full text with tier markers
    const parts = [];
    if (merged.preamble) {
      parts.push(merged.preamble);
    }
    for (const [name, content] of Object.entries(merged.sections)) {
      parts.push(`## ${name.replace(/_/g, ' ').toUpperCase()}\n\n${content}`);
    }
    merged.fullText = parts.join('\n\n');

    return merged;
  }

  /**
   * Get cached policies (if loaded within last 5 minutes)
   */
  getCached() {
    if (!this.cache) return null;
    if (Date.now() - this.lastLoad > 5 * 60 * 1000) return null;
    return this.cache;
  }

  /**
   * Get specific section from merged policies
   */
  getSection(sectionName) {
    const cached = this.getCached();
    if (!cached) return null;
    return cached.merged.sections[sectionName] || null;
  }

  /**
   * Clear cache (force reload on next call)
   */
  clearCache() {
    this.cache = null;
    this.lastLoad = null;
  }
}

/**
 * Build system message from policies + session context
 */
export function buildSystemMessage(policies, sessionContext = {}) {
  const parts = [];

  // Policy preamble
  if (policies.preamble) {
    parts.push(policies.preamble);
  }

  // Session-specific context
  if (sessionContext.taskGoal) {
    parts.push(`## CURRENT TASK\n\n${sessionContext.taskGoal}`);
  }

  if (sessionContext.currentSubplan) {
    parts.push(`## CURRENT PHASE\n\n${sessionContext.currentSubplan}`);
  }

  if (sessionContext.constraints) {
    parts.push(`## CONSTRAINTS\n\n${sessionContext.constraints.join('\n')}`);
  }

  // Policy sections
  for (const [name, content] of Object.entries(policies.sections)) {
    if (name === 'preamble') continue;
    parts.push(`## ${name.replace(/_/g, ' ').toUpperCase()}\n\n${content}`);
  }

  return parts.join('\n\n');
}
