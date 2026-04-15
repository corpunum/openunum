import { describe, it, expect } from 'vitest';
import { extractRequirements, synthesizeToolOnlyAnswer } from '../../src/core/turn-recovery-summary.mjs';

describe('Dataset Research Trigger Fix', () => {
  it('should not trigger dataset research for general "usable" queries', () => {
    const requirements = extractRequirements('what can you do');
    expect(requirements.asksResearch).toBe(false);
    expect(requirements.asksDataset).toBe(false);
  });

  it('should trigger dataset research for specific dataset queries', () => {
    const requirements = extractRequirements('find usable datasets for training');
    expect(requirements.asksResearch).toBe(true);
    expect(requirements.asksDataset).toBe(true);
  });

  it('should not trigger dataset research for "how are you usable"', () => {
    const requirements = extractRequirements('how are you usable');
    expect(requirements.asksResearch).toBe(false);
    expect(requirements.asksDataset).toBe(false);
  });

  it('should not treat explanatory "how is" prompts as step-by-step instructions', () => {
    const requirements = extractRequirements('How is meta harness is working for openunum ?');
    expect(requirements.asksSteps).toBe(false);
    expect(requirements.asksExplanation).toBe(true);
  });

  it('should trigger dataset research for "hugging face datasets"', () => {
    const requirements = extractRequirements('hugging face datasets for ai training');
    expect(requirements.asksResearch).toBe(true);
    expect(requirements.asksDataset).toBe(true);
  });

  it('should trigger dataset research for "training data"', () => {
    const requirements = extractRequirements('find training data for models');
    expect(requirements.asksResearch).toBe(true);
    expect(requirements.asksDataset).toBe(true);
  });

  it('should not trigger dataset research for general questions', () => {
    const requirements = extractRequirements('what is the weather today');
    expect(requirements.asksResearch).toBe(false);
    expect(requirements.asksDataset).toBe(false);
  });

  it('should not classify weather requests as status reports', () => {
    const requirements = extractRequirements('hello can you check the weather in greece/rafina ?');
    expect(requirements.asksWeather).toBe(true);
    expect(requirements.asksStatus).toBe(false);
  });

  it('should detect misspelled weather intent and avoid status classification', () => {
    const requirements = extractRequirements('hello can you check the weaather in greece/rafina ?');
    expect(requirements.asksWeather).toBe(true);
    expect(requirements.asksStatus).toBe(false);
  });
});

describe('Synthesize Tool Only Answer', () => {
  it('should not return dataset research for non-dataset queries', () => {
    const result = synthesizeToolOnlyAnswer({
      userMessage: 'what can you do',
      executedTools: [],
      toolRuns: 0
    });
    expect(result).not.toContain('Usable Hugging Face datasets found for this ask:');
  });

  it('should return dataset research for dataset queries', () => {
    const result = synthesizeToolOnlyAnswer({
      userMessage: 'find datasets for ai training',
      executedTools: [{
        name: 'http_request',
        result: {
          ok: true,
          url: 'https://huggingface.co/api/datasets?search=agent',
          json: [{
            id: 'test/dataset',
            downloads: 100,
            likes: 10,
            tags: ['agent', 'tool-calling'],
            description: 'Test dataset'
          }]
        }
      }],
      toolRuns: 1
    });
    expect(result).toContain('Usable Hugging Face datasets found for this ask:');
  });

  it('should return ranked web candidates for best/top queries when web_search evidence exists', () => {
    const result = synthesizeToolOnlyAnswer({
      userMessage: 'best github open source projects march april 2026',
      executedTools: [{
        name: 'web_search',
        result: {
          ok: true,
          results: [
            {
              title: 'Repo Alpha',
              url: 'https://github.com/org/repo-alpha',
              snippet: 'Active in March 2026'
            },
            {
              title: 'Repo Beta',
              url: 'https://github.com/org/repo-beta',
              snippet: 'Major release in April 2026'
            }
          ]
        }
      }],
      toolRuns: 1
    });
    expect(result).toContain('Top candidates from current web evidence:');
    expect(result).toContain('Repo Alpha');
    expect(result).toContain('Recommendation:');
  });

  it('should synthesize a direct harness explanation instead of next-step boilerplate', () => {
    const result = synthesizeToolOnlyAnswer({
      userMessage: 'How is meta harness is working for openunum ?',
      executedTools: [
        {
          name: 'file_grep',
          result: {
            ok: true,
            matches: [
              { file: '/home/corp-unum/openunum/src/core/autonomy-nudges.mjs', line: 'meta_harness_review' },
              { file: '/home/corp-unum/openunum/tests/unit/autonomy-nudges.test.mjs', line: 'meta_harness_review' }
            ]
          }
        },
        {
          name: 'file_search',
          result: {
            ok: true,
            files: [
              '/home/corp-unum/openunum/src/core/autonomy-nudges.mjs',
              '/home/corp-unum/openunum/docs/MODEL_AWARE_CONTROLLER.md'
            ]
          }
        }
      ],
      toolRuns: 2
    });
    expect(result).toContain('not implemented as a first-class runtime module');
    expect(result).not.toContain('Best next steps from current evidence');
  });

  it('should synthesize a direct code-doc review answer instead of status output', () => {
    const result = synthesizeToolOnlyAnswer({
      userMessage: 'Check your code and latest changelogs , also agentonboarding and tell me if all make sense for you , you think we miss something , or something is not linked to code or used ?',
      executedTools: [
        {
          name: 'file_read',
          result: {
            ok: true,
            path: '/home/corp-unum/openunum/src/core/agent.mjs',
            content: 'import crypto from node:crypto;'
          }
        },
        {
          name: 'file_read',
          result: {
            ok: true,
            path: '/home/corp-unum/openunum/docs/archive/agent-onboarding.md',
            content: '# OpenUnum Agent Onboarding Guide'
          }
        },
        {
          name: 'file_search',
          result: {
            ok: true,
            files: [
              '/home/corp-unum/openunum/CHANGELOG.md',
              '/home/corp-unum/openunum/docs/CHANGELOG_CURRENT.md'
            ]
          }
        },
        {
          name: 'shell_run',
          result: {
            ok: true,
            stdout: 'AGENT_ONBOARDING.md\nCHANGELOG.md\nCHANGELOG_CURRENT.md'
          }
        }
      ],
      toolRuns: 4
    });
    expect(result).toContain('retrieval drift');
    expect(result).not.toContain('Status: ok');
    expect(result).not.toContain('Best next steps from current evidence');
  });

  it('should synthesize a direct code-doc review answer from shell file listings', () => {
    const result = synthesizeToolOnlyAnswer({
      userMessage: 'Check your code and latest changelogs , also agentonboarding and tell me if all make sense for you , you think we miss something , or something is not linked to code or used ?',
      executedTools: [
        {
          name: 'shell_run',
          result: {
            ok: true,
            stdout: [
              '/home/corp-unum/openunum/src/core/agent.mjs',
              '/home/corp-unum/openunum/docs/archive/agent-onboarding.md',
              '/home/corp-unum/openunum/docs/AGENT_ONBOARDING.md',
              '/home/corp-unum/openunum/CHANGELOG.md',
              '/home/corp-unum/openunum/docs/CHANGELOG_CURRENT.md'
            ].join('\n')
          }
        }
      ],
      toolRuns: 1
    });
    expect(result).toContain('retrieval drift');
    expect(result).not.toContain('Status: ok');
  });

  it('should synthesize direct weather answer instead of status/findings format', () => {
    const result = synthesizeToolOnlyAnswer({
      userMessage: 'i dont want links, i want you to tell me the weather in rafina greece now',
      executedTools: [
        {
          name: 'web_fetch',
          result: {
            ok: true,
            url: 'https://www.accuweather.com/en/gr/rafina/182477/current-weather/182477',
            content: 'Rafina current weather 22° C cloudy with light wind.'
          }
        }
      ],
      toolRuns: 1
    });
    expect(result).toContain('Current weather for');
    expect(result).not.toContain('Status:');
    expect(result).not.toContain('Findings:');
  });
});
