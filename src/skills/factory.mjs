import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir } from '../config.mjs';

const DOMAIN_EXPERT_HINTS = {
  system: `System experts encode: CPU load >80% = warning, >95% = critical; 16k context window = summarize history every 10 turns; process.kill requires PID validation; lock files prevent race conditions; use non-blocking I/O for long tasks; monitor port 18880 availability.`,
  ai: `AI experts encode: 1.5B model tool-calling = use EXACT parameter names; provide 2 examples per tool; deterministic output = temperature 0.0; 16k context = front-load most critical instructions; chain-of-thought helps reasoning but uses tokens.`,
  automation: `Automation experts encode: idempotency = check if result already exists before acting; retries = exponential backoff; verification = MUST check side-effects (file exists, service up) after execution; log everything for debugging.`,
  dev: `Dev experts encode: lint before commit; unit test critical paths; use relative paths within workspace; maintain backward compatibility; document every public API; use async/await for I/O.`,
};

export class SkillFactory {
  constructor(config, chatRuntime) {
    this.config = config;
    this.chatRuntime = chatRuntime;
    this.homeDir = getHomeDir();
  }

  async generateBundle(goal, researchSummary = '') {
    const prompt = `You are a SENIOR AI SKILL ARCHITECT. Generate a production-ready expert skill bundle optimized for the OpenUnum system (ROG Ally X, CPU-only, Qwen 2.5 1.5B).

GOAL: "${goal}"
${researchSummary ? `RESEARCH SUMMARY: ${researchSummary}` : ''}

EXPERT HINTS:
${DOMAIN_EXPERT_HINTS.system}
${DOMAIN_EXPERT_HINTS.ai}
${DOMAIN_EXPERT_HINTS.automation}

Return JSON with these exact fields:
- skill_md: Complete SKILL.md with YAML frontmatter (name, description, triggers, version).
- meta_json: _meta.json content (JSON string).
- knowledge_md: Expert knowledge base with specific thresholds/rules.
- decision_tree_md: 10-15 precise IF/THEN rules for model reasoning.
- examples_md: 3-5 worked examples.
- execute_mjs: (Optional) Javascript module code for specific automation.

Ensure the "decision_tree_md" is optimized for a 1.5B parameter model (clear, unambiguous, deterministic).`;

    // We use the chatRuntime to generate the bundle. 
    // We prefer a strong cloud model for generation if available.
    const response = await this.chatRuntime.chat({
      sessionId: `factory-${Date.now()}`,
      message: prompt,
      jsonMode: true
    });

    try {
      // ChatRuntime response might be wrapped or plain string depending on provider
      const content = response.reply || response;
      const bundle = typeof content === 'string' ? JSON.parse(this.stripFences(content)) : content;
      
      return {
        ok: true,
        files: {
          'SKILL.md': bundle.skill_md,
          '_meta.json': bundle.meta_json,
          'knowledge.md': bundle.knowledge_md,
          'decision_tree.md': bundle.decision_tree_md,
          'examples.md': bundle.examples_md,
          'execute.mjs': bundle.execute_mjs || this.defaultExecuteMjs(bundle.name || 'skill')
        }
      };
    } catch (err) {
      return { ok: false, error: `generation_parse_failed: ${err.message}` };
    }
  }

  stripFences(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  }

  defaultExecuteMjs(name) {
    return `export async function execute(args = {}) {
  return { ok: true, skill: "${name}", status: "documentation_only_execution_recommended" };
}
export default execute;`;
  }
}
