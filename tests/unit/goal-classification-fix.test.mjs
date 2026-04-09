import { describe, it, expect } from 'vitest';
import { classifyGoal } from '../../src/core/goal-task-planner.mjs';
import { isConversationalAliveQuestion } from '../../src/core/agent.mjs';

describe('Goal Classification Fix', () => {
  it('should not classify "So you are alive?" as model scouting', () => {
    const classification = classifyGoal('So you are alive?');
    expect(classification.wantsModelScout).toBe(false);
    expect(classification.wantsSearch).toBe(false);
    expect(classification.wantsRuntime).toBe(false);
  });

  it('should classify explicit model requests as model scouting', () => {
    const classification = classifyGoal('Find me the best HuggingFace models for tool calling');
    expect(classification.wantsModelScout).toBe(true);
  });

  it('should classify model search requests as model scouting', () => {
    const classification = classifyGoal('Search for LLM models that can do tool calling');
    expect(classification.wantsModelScout).toBe(true);
  });

  it('should not classify general questions as model scouting', () => {
    const testCases = [
      'So you are alive?',
      'Are you working?',
      'What are you doing?',
      'How are you doing?',
      'Hello, are you there?',
      'Testing if you respond'
    ];

    testCases.forEach(testCase => {
      const classification = classifyGoal(testCase);
      expect(classification.wantsModelScout, `Failed for: ${testCase}`).toBe(false);
    });
  });

  it('should still classify legitimate model requests', () => {
    const testCases = [
      'Find HuggingFace models for tool calling',
      'Search for the best LLM models',
      'Download GGUF models from Ollama',
      'Compare different safetensors models',
      'Research GGML models for local inference'
    ];

    testCases.forEach(testCase => {
      const classification = classifyGoal(testCase);
      expect(classification.wantsModelScout, `Failed for: ${testCase}`).toBe(true);
    });
  });

  it('should identify conversational alive/dead questions', () => {
    const conversationalQuestions = [
      'So you are alive?',
      'Are you dead or alive?',
      'Are you alive?',
      'Are you dead?'
    ];

    conversationalQuestions.forEach(question => {
      const result = isConversationalAliveQuestion(question);
      expect(result, `Failed for: ${question}`).toBe(true);
    });
  });

  it('should not identify technical health check requests as conversational', () => {
    const technicalRequests = [
      'Check system health',
      'Run health check',
      'Status check please',
      'Diagnose the system',
      'Monitor the service'
    ];

    technicalRequests.forEach(request => {
      const result = isConversationalAliveQuestion(request);
      expect(result, `Failed for: ${request}`).toBe(false);
    });
  });
});
