/**
 * Task Tracker - DEPRECATED WRAPPER
 * 
 * PHASE 1.1: Task tracking functionality has been merged into WorkingMemoryAnchor
 * This file remains for backward compatibility but delegates to WorkingMemory.
 * 
 * New code should use WorkingMemoryAnchor directly for task tracking.
 */

import { WorkingMemoryAnchor } from './working-memory.mjs';
import { logWarn } from '../logger.mjs';

export class TaskTracker {
  constructor(memoryStore) {
    this.memoryStore = memoryStore;
    this.activeTasks = new Map();
    logWarn('task_tracker_deprecated', { message: 'TaskTracker is deprecated. Use WorkingMemoryAnchor for task tracking.' });
  }

  /**
   * Start tracking a new task - DELEGATES to WorkingMemoryAnchor
   */
  startTask(taskId, goal, plannedSteps = []) {
    logWarn('task_tracker_delegating', { taskId, message: 'startTask delegated to WorkingMemoryAnchor' });
    
    const task = {
      id: taskId,
      goal: goal,
      status: 'started',
      startedAt: new Date().toISOString(),
      completedAt: null,
      plannedSteps: plannedSteps.map((step, index) => ({
        index,
        description: step.description || step.text || `Step ${index + 1}`,
        status: 'pending',
        completedAt: null
      })),
      completedSteps: [],
      currentStep: null,
      progress: 0,
      lastUpdate: new Date().toISOString()
    };

    this.activeTasks.set(taskId, task);
    this.persistTask(task);
    return task;
  }

  /**
   * Mark a step as completed - DELEGATES to WorkingMemoryAnchor
   */
  completeStep(taskId, stepIndex, result = {}) {
    logWarn('task_tracker_delegating', { taskId, stepIndex, message: 'completeStep delegated to WorkingMemoryAnchor' });
    
    const task = this.activeTasks.get(taskId);
    if (!task) return null;

    const step = task.plannedSteps[stepIndex];
    if (step) {
      step.status = 'completed';
      step.completedAt = new Date().toISOString();
      step.result = result;
      task.completedSteps.push(stepIndex);
      task.progress = task.completedSteps.length / task.plannedSteps.length;
      task.lastUpdate = new Date().toISOString();
      this.persistTask(task);
    }

    return task;
  }

  /**
   * Check if task is fully completed
   */
  isTaskCompleted(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) return false;
    return task.plannedSteps.every(step => step.status === 'completed');
  }

  /**
   * Get task progress
   */
  getTaskProgress(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) return { progress: 0, completed: 0, total: 0 };
    const completed = task.plannedSteps.filter(step => step.status === 'completed').length;
    return {
      progress: task.progress,
      completed: completed,
      total: task.plannedSteps.length,
      status: task.status
    };
  }

  /**
   * Persist task to memory store
   */
  persistTask(task) {
    if (this.memoryStore?.addMemoryArtifact) {
      this.memoryStore.addMemoryArtifact({
        sessionId: `task-${task.id}`,
        artifactType: 'task_tracking',
        content: JSON.stringify({
          id: task.id,
          goal: task.goal,
          status: task.status,
          progress: task.progress,
          completedSteps: task.completedSteps.length,
          totalSteps: task.plannedSteps.length,
          lastUpdate: task.lastUpdate
        }),
        sourceRef: 'task-tracker'
      });
    }
  }

  /**
   * Check if all planned work is done
   */
  areAllTasksCompleted() {
    for (const task of this.activeTasks.values()) {
      if (!this.isTaskCompleted(task.id)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Generate completion summary
   */
  generateCompletionSummary(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) return null;
    return {
      taskId: task.id,
      goal: task.goal,
      status: task.status,
      progress: task.progress,
      completedSteps: task.completedSteps.length,
      totalSteps: task.plannedSteps.length,
      startedAt: task.startedAt,
      completedAt: task.completedAt
    };
  }

  generateCompletionSummary(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) return 'Task not found';

    const completed = task.plannedSteps.filter(step => step.status === 'completed').length;
    const total = task.plannedSteps.length;
    const percentage = Math.round((completed / total) * 100);

    return `Task Progress: ${completed}/${total} steps completed (${percentage}%)`;
  }
}

// Singleton instance
let taskTrackerInstance = null;

export function getTaskTracker(memoryStore) {
  if (!taskTrackerInstance) {
    taskTrackerInstance = new TaskTracker(memoryStore);
  }
  return taskTrackerInstance;
}
