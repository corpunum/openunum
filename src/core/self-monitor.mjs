/**
 * Self Monitor - Automatically checks progress and continues execution without user prompts
 */

import { isProofBackedDone } from './execution-contract.mjs';
import { scoreProofQuality } from './proof-scorer.mjs';

export class SelfMonitor {
  constructor(agent) {
    this.agent = agent;
    this.monitoringSessions = new Map();
  }

  /**
   * Start monitoring a session for automatic continuation
   */
  startMonitoring(sessionId, goal) {
    this.monitoringSessions.set(sessionId, {
      sessionId,
      goal,
      startedAt: new Date().toISOString(),
      lastCheck: new Date().toISOString(),
      checkCount: 0,
      shouldContinue: true
    });
  }

  /**
   * Check if a session should automatically continue
   */
  shouldAutoContinue(sessionId, currentText, toolRuns) {
    const monitoring = this.monitoringSessions.get(sessionId);
    if (!monitoring || !monitoring.shouldContinue) return false;

    // Increment check count
    monitoring.checkCount += 1;
    monitoring.lastCheck = new Date().toISOString();

    // If we have tool runs but no clear completion, we should continue
    if (Array.isArray(toolRuns) && toolRuns.length > 0) {
      try {
        const proofScore = scoreProofQuality({
          assistantText: currentText,
          toolRuns: toolRuns,
          taskGoal: monitoring.goal || ''
        });

        // If we have low confidence in completion, continue
        if (proofScore.score < 0.6) {
          return true;
        }

        // If we have medium confidence but it's early in monitoring, continue
        if (proofScore.score < 0.8 && monitoring.checkCount < 3) {
          return true;
        }

        // Check if it's actually done with our enhanced criteria
        const isActuallyDone = isProofBackedDone({
          text: currentText,
          toolRuns: toolRuns,
          requireProofForDone: true,
          taskGoal: monitoring.goal || ''
        });

        // If not actually done, continue
        if (!isActuallyDone) {
          return true;
        }
      } catch (e) {
        // If scoring fails, fall back to checking for actual completion
        const isActuallyDone = isProofBackedDone({
          text: currentText,
          toolRuns: toolRuns,
          requireProofForDone: true,
          taskGoal: monitoring.goal || ''
        });
        return !isActuallyDone;
      }
    }

    // If no tool runs, we might still be planning - continue
    if (!toolRuns || toolRuns.length === 0) {
      return monitoring.checkCount < 5; // Allow up to 5 checks for planning
    }

    return false;
  }

  /**
   * Stop monitoring a session
   */
  stopMonitoring(sessionId) {
    const monitoring = this.monitoringSessions.get(sessionId);
    if (monitoring) {
      monitoring.shouldContinue = false;
      monitoring.stoppedAt = new Date().toISOString();
    }
  }

  /**
   * Check if we're monitoring a session
   */
  isMonitoring(sessionId) {
    const monitoring = this.monitoringSessions.get(sessionId);
    return monitoring && monitoring.shouldContinue;
  }

  /**
   * Get monitoring status for a session
   */
  getMonitoringStatus(sessionId) {
    return this.monitoringSessions.get(sessionId) || null;
  }

  /**
   * Generate a continuation prompt based on current state
   */
  generateContinuationPrompt(sessionId, currentText, toolRuns) {
    const monitoring = this.monitoringSessions.get(sessionId);
    if (!monitoring) return '';

    let promptParts = [
      'AUTONOMOUS CONTINUATION DIRECTIVE:',
      'Continue execution without user prompting. Validate all completion claims.'
    ];

    // Add context based on current state
    if (Array.isArray(toolRuns) && toolRuns.length > 0) {
      try {
        const proofScore = scoreProofQuality({
          assistantText: currentText,
          toolRuns: toolRuns,
          taskGoal: monitoring.goal || ''
        });

        promptParts.push(`Current proof confidence: ${Math.round(proofScore.score * 100)}%`);

        if (proofScore.score < 0.5) {
          promptParts.push('INSUFFICIENT PROOF - Continue with concrete tool actions.');
        } else if (proofScore.score < 0.7) {
          promptParts.push('PARTIAL PROOF - Verify completion with additional evidence.');
        }
      } catch (e) {
        promptParts.push('Proof scoring unavailable - proceed with caution.');
      }
    } else {
      promptParts.push('NO TOOL EXECUTION DETECTED - Begin concrete tool actions.');
    }

    promptParts.push(`Original goal: ${monitoring.goal || 'Unknown'}`);
    promptParts.push('Next step: Execute specific tool actions with verifiable outcomes.');

    return promptParts.join('\n');
  }
}

// Singleton instance
let selfMonitorInstance = null;

export function getSelfMonitor(agent) {
  if (!selfMonitorInstance) {
    selfMonitorInstance = new SelfMonitor(agent);
  }
  return selfMonitorInstance;
}