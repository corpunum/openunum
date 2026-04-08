import { describe, it, expect } from 'vitest';
import { CompletionChecklist } from '../../src/core/completion-checklist.mjs';

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
  });
});
