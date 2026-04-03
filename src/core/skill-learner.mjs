import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir } from '../config.mjs';
import { logInfo, logWarn } from '../logger.mjs';
import { SkillManager } from '../skills/manager.mjs';

/**
 * SkillLearner - Automatically extracts and saves successful patterns
 * from mission completions and tool executions.
 */
export class SkillLearner {
  constructor({ memoryStore }) {
    this.memoryStore = memoryStore;
    this.skillsDir = path.join(getHomeDir(), 'skills');
    this.minSuccessThreshold = 2; // Need 2+ successes to create a skill
    this.skillManager = new SkillManager();
    this.ensureSkillsDir();
  }

  ensureSkillsDir() {
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }
  }

  /**
   * Analyze recent successful missions and extract patterns
   */
  async learnFromRecentMissions(limit = 20) {
    const learned = [];
    
    // Get recent successful strategy outcomes
    const successfulOutcomes = this.memoryStore.retrieveStrategyHints('', limit)
      .filter(o => o.success);

    // Group by goal pattern
    const goalPatterns = new Map();
    for (const outcome of successfulOutcomes) {
      const normalizedGoal = this.normalizeGoal(outcome.goal || '');
      if (!goalPatterns.has(normalizedGoal)) {
        goalPatterns.set(normalizedGoal, []);
      }
      goalPatterns.get(normalizedGoal).push(outcome);
    }

    // Create skills for patterns with multiple successes
    for (const [pattern, outcomes] of goalPatterns.entries()) {
      if (outcomes.length >= this.minSuccessThreshold) {
        const skill = this.extractSkillFromOutcomes(pattern, outcomes);
        if (skill) {
          this.saveSkill(skill);
          learned.push(skill);
          logInfo('skill_learned', { name: skill.name, successes: outcomes.length });
        }
      }
    }

    return learned;
  }

  /**
   * Normalize a goal string to find patterns
   */
  normalizeGoal(goal) {
    return goal
      .toLowerCase()
      .replace(/\bhttps?:\/\/\S+\b/g, '{url}')
      .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, '{ip}')
      .replace(/\b\/[\w/.-]+\b/g, '{path}')
      .replace(/\b[a-f0-9]{8,}\b/g, '{hash}')
      .trim();
  }

  /**
   * Extract a skill from multiple successful outcomes
   */
  extractSkillFromOutcomes(pattern, outcomes) {
    // Analyze tool runs from these sessions
    const toolSequences = [];

    // Derive candidate sessions from recent session activity.
    const sessions = this.findRelatedSessions(pattern);
    for (const sessionId of sessions.slice(0, 6)) {
      const toolRuns = this.memoryStore.getRecentToolRuns(sessionId, 12);
      if (toolRuns.length > 0 && toolRuns.some((t) => t.ok)) {
        toolSequences.push(toolRuns.filter((t) => t.ok).map((t) => t.toolName));
      }
    }

    if (toolSequences.length === 0) return null;

    // Find common tool sequence pattern
    const commonSequence = this.findCommonPrefix(toolSequences);
    
    if (commonSequence.length < 2) return null;

    const skillName = this.generateSkillName(pattern);
    
    return {
      name: skillName,
      description: `Auto-learned skill for: ${pattern}`,
      pattern: pattern,
      toolSequence: commonSequence,
      successCount: outcomes.length,
      createdAt: new Date().toISOString(),
      content: this.generateSkillContent(skillName, pattern, commonSequence, outcomes)
    };
  }

  /**
   * Find sessions related to a goal pattern
   */
  findRelatedSessions(pattern) {
    const all = this.memoryStore.listSessions?.(40) || [];
    const tokens = new Set(String(pattern || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    if (!tokens.size) {
      return all.map((s) => s.sessionId).filter(Boolean);
    }
    return all
      .filter((session) => {
        const corpus = `${session.title || ''} ${session.preview || ''}`.toLowerCase();
        let hits = 0;
        for (const token of tokens) if (corpus.includes(token)) hits += 1;
        return hits > 0;
      })
      .map((s) => s.sessionId)
      .filter(Boolean);
  }

  /**
   * Find common prefix in tool sequences
   */
  findCommonPrefix(sequences) {
    if (sequences.length === 0) return [];
    if (sequences.length === 1) return sequences[0];

    const first = sequences[0];
    const prefix = [];
    
    for (let i = 0; i < first.length; i++) {
      const tool = first[i];
      if (sequences.every(seq => seq[i] === tool)) {
        prefix.push(tool);
      } else {
        break;
      }
    }

    return prefix;
  }

  /**
   * Generate a skill name from pattern
   */
  generateSkillName(pattern) {
    return pattern
      .split(/\s+/)
      .slice(0, 4)
      .map(w => w.replace(/[^a-z0-9]/gi, ''))
      .filter(w => w.length > 0)
      .join('-')
      .substring(0, 50) || 'auto-skill';
  }

  /**
   * Generate skill content markdown
   */
  generateSkillContent(name, pattern, toolSequence, outcomes) {
    return `# Skill: ${name}

## Description
Auto-learned skill for pattern: "${pattern}"

## Success Count
${outcomes.length} successful executions

## Tool Sequence
${toolSequence.map((t, i) => `${i + 1}. ${t}`).join('\n')}

## Usage
This skill is automatically applied when similar goals are detected.

## Learned At
${new Date().toISOString()}
`;
  }

  /**
   * Save a skill to disk
   */
  saveSkill(skill) {
    const moduleSource = [
      '// Auto-learned executable skill module.',
      `export const metadata = ${JSON.stringify({
        name: skill.name,
        description: skill.description,
        pattern: skill.pattern,
        toolSequence: skill.toolSequence,
        successCount: skill.successCount,
        createdAt: skill.createdAt
      }, null, 2)};`,
      '',
      'export async function execute(args = {}) {',
      '  const steps = Array.isArray(args?.steps) && args.steps.length ? args.steps : metadata.toolSequence;',
      '  return {',
      '    ok: true,',
      '    learned: true,',
      '    skill: metadata.name,',
      '    pattern: metadata.pattern,',
      '    successCount: metadata.successCount,',
      '    suggestedSteps: steps,',
      '    args',
      '  };',
      '}',
      '',
      'export default execute;',
      ''
    ].join('\n');
    const out = this.skillManager.upsertGeneratedSkill({
      name: skill.name,
      description: skill.description,
      pattern: skill.pattern,
      toolSequence: skill.toolSequence,
      evidence: `learned_success_count=${skill.successCount}`,
      content: moduleSource,
      source: 'auto-learned'
    });
    return out;
  }

  /**
   * Load all skills from disk
   */
  loadSkills() {
    this.ensureSkillsDir();
    const skills = [];
    
    try {
      const files = fs.readdirSync(this.skillsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const skillPath = path.join(this.skillsDir, file);
          const content = fs.readFileSync(skillPath, 'utf8');
          skills.push({
            name: file.replace('.md', ''),
            path: skillPath,
            content
          });
        }
      }
    } catch (error) {
      logWarn('skill_load_error', { error: String(error.message || error) });
    }

    return skills;
  }

  /**
   * Record a successful execution for future learning
   */
  recordSuccess({ goal, strategy, toolSequence, evidence }) {
    this.memoryStore.recordStrategyOutcome({
      goal,
      strategy,
      success: true,
      evidence: evidence || `tools_used: ${toolSequence?.join(',') || 'unknown'}`
    });
  }

  /**
   * Record a failed execution to avoid repeating mistakes
   */
  recordFailure({ goal, strategy, error, toolSequence }) {
    this.memoryStore.recordStrategyOutcome({
      goal,
      strategy,
      success: false,
      evidence: `error: ${error?.message || error || 'unknown'}, tools: ${toolSequence?.join(',') || 'none'}`
    });
  }

  /**
   * Get skill suggestions for a goal
   */
  getSuggestionsForGoal(goal, limit = 3) {
    const skills = this.loadSkills();
    const normalizedGoal = this.normalizeGoal(goal);
    
    // Score skills by pattern match
    const scored = skills.map(skill => {
      const skillPattern = this.normalizeGoal(skill.pattern || '');
      const matchScore = this.calculateMatchScore(normalizedGoal, skillPattern);
      return { skill, score: matchScore };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.skill);
  }

  /**
   * Calculate match score between goal and pattern
   */
  calculateMatchScore(goal, pattern) {
    const goalWords = new Set(goal.split(/\s+/));
    const patternWords = new Set(pattern.split(/\s+/));
    
    let matches = 0;
    for (const word of patternWords) {
      if (word.length > 2 && goalWords.has(word)) {
        matches++;
      }
    }

    return matches / Math.max(patternWords.size, 1);
  }

  /**
   * Get statistics about learned skills
   */
  getStats() {
    const skills = this.loadSkills();
    return {
      totalSkills: skills.length,
      skillsDir: this.skillsDir,
      skills: skills.map(s => ({
        name: s.name,
        path: s.path
      }))
    };
  }
}
