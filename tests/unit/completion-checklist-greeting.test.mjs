import { describe, it, expect } from 'vitest';
import { CompletionChecklist, detectSteps } from '../../src/core/completion-checklist.mjs';

describe('CompletionChecklist - Greeting Bug Fix', () => {
  describe('getProgress with no task', () => {
    it('should return 0% when no task initialized', () => {
      const checklist = new CompletionChecklist();
      const progress = checklist.getProgress();
      
      expect(progress.total).toBe(0);
      expect(progress.percent).toBe(0);
      expect(progress.hasTask).toBe(false);
    });

    it('should return hasTask=false for empty checklist', () => {
      const checklist = new CompletionChecklist();
      expect(checklist.getProgress().hasTask).toBe(false);
    });
  });

  describe('getProgress with task', () => {
    it('should return hasTask=true when task initialized', () => {
      const checklist = new CompletionChecklist();
      checklist.initFromSteps(['Step 1', 'Step 2']);
      const progress = checklist.getProgress();
      
      expect(progress.total).toBe(2);
      expect(progress.hasTask).toBe(true);
    });

    it('should return 100% when all steps complete', () => {
      const checklist = new CompletionChecklist();
      checklist.initFromSteps(['Step 1', 'Step 2']);
      checklist.markComplete('step-0', {});
      checklist.markComplete('step-1', {});
      const progress = checklist.getProgress();
      
      expect(progress.percent).toBe(100);
      expect(progress.hasTask).toBe(true);
    });

    it('should return partial percent when some steps complete', () => {
      const checklist = new CompletionChecklist();
      checklist.initFromSteps(['Step 1', 'Step 2', 'Step 3', 'Step 4']);
      checklist.markComplete('step-0', {});
      checklist.markComplete('step-1', {});
      const progress = checklist.getProgress();
      
      expect(progress.percent).toBe(50);
      expect(progress.hasTask).toBe(true);
    });

    it('resets prior task state between turns', () => {
      const checklist = new CompletionChecklist();
      checklist.initFromSteps(['Step 1']);
      checklist.markComplete('step-0', {});
      checklist.reset();
      const progress = checklist.getProgress();

      expect(progress.total).toBe(0);
      expect(progress.percent).toBe(0);
      expect(progress.hasTask).toBe(false);
    });
  });

  describe('detectSteps fallback quality', () => {
    it('returns mapped actionable steps instead of generic execute verbs', () => {
      const steps = detectSteps('read config and update routing then verify');
      expect(Array.isArray(steps)).toBe(true);
      expect(steps?.length).toBeGreaterThan(1);
      expect(steps?.some((step) => step.includes('Execute:'))).toBe(false);
      expect(steps?.[0]).toMatch(/Inspect|Read/i);
    });

    it('returns task-specific steps for spot-the-difference game requests', () => {
      const steps = detectSteps('can you write an html page game to spot 3 differences');
      expect(Array.isArray(steps)).toBe(true);
      expect(steps?.length).toBeGreaterThanOrEqual(5);
      expect(steps?.join(' ')).toMatch(/difference|click|progress/i);
    });

    it('does not decompose over-broad verb-only prompts', () => {
      const steps = detectSteps('read write create delete install configure test run check list find update modify deploy build verify');
      expect(steps).toBeNull();
    });
  });
});
