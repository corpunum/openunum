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
});
