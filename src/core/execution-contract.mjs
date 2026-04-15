import { scoreProofQuality } from './proof-scorer.mjs';

function normalize(text) {
  return String(text || '').toLowerCase();
}

export function isProofBackedDone({ text, toolRuns, requireProofForDone = true, taskGoal = '' }) {
  const t = normalize(text);
  const claimsDone = /\b(done|completed|finished|mission_status:\s*done)\b/.test(t);
  if (!claimsDone) return false;
  if (!requireProofForDone) return true;

  // Use proof scorer for better validation
  if (Array.isArray(toolRuns) && toolRuns.length > 0) {
    try {
      const proofScore = scoreProofQuality({
        assistantText: text,
        toolRuns: toolRuns,
        taskGoal: taskGoal || ''
      });
      // Require at least 0.5 confidence for "done" claims
      return proofScore.confident || proofScore.score >= 0.5;
    } catch (e) {
      // Fallback to original logic if scoring fails
      return Number(toolRuns.length || 0) > 0;
    }
  }

  return false;
}

export function shouldForceContinuation({
  assistantText,
  toolCalls,
  toolRuns,
  iteration,
  maxIters,
  priorForcedCount,
  taskGoal = ''
}) {
  if (Array.isArray(toolCalls) && toolCalls.length > 0) return false;
  if (iteration >= maxIters) return false;
  if (Number(priorForcedCount || 0) >= 2) return false;
  if (Number(toolRuns || 0) <= 0) return false;
  const text = normalize(assistantText);
  if (!text.trim()) return true;

  // Use proof scorer to determine if we should continue
  if (Array.isArray(toolRuns) && toolRuns.length > 0) {
    try {
      const proofScore = scoreProofQuality({
        assistantText: text,
        toolRuns: toolRuns,
        taskGoal: taskGoal || ''
      });
      // If we have low confidence, we should continue
      if (proofScore.score < 0.3) return true;
      // If we have medium confidence but no clear done claim, continue
      if (proofScore.score < 0.7 && !/\b(done|completed|finished|mission_status:\s*done)\b/.test(text)) return true;
    } catch (e) {
      // Fallback to original logic if scoring fails
      if (isProofBackedDone({ text, toolRuns, requireProofForDone: true })) return false;
      return /plan|i will|next|let me|approach|strategy/.test(text);
    }
  }

  if (isProofBackedDone({ text, toolRuns, requireProofForDone: true, taskGoal })) return false;
  return /plan|i will|next|let me|approach|strategy/.test(text);
}

export function continuationDirective(reason = 'continue_execution') {
  return [
    'Execution contract reminder:',
    '1. Do not stop at planning text.',
    '2. Continue with concrete tool actions now.',
    '3. Only produce DONE language when proof is present from tool results in this turn.',
    '4. Validate completion claims with evidence scoring.',
    `Reason: ${reason}`
  ].join('\n');
}

export function recoveryDirective() {
  return [
    'Answer the user directly in normal prose based only on completed tool results.',
    'Do not call tools.',
    'Do not emit operator headings like "Status:", "Findings:", or "Best next steps" unless the user explicitly asked for status or steps.',
    'If relevant, explain what the evidence means, not only which tools ran.',
    'Include what succeeded, what failed, and next concrete step only when that helps answer the user.',
    'If no proof exists for completion, explicitly say not done.',
    'Validate completion with evidence scoring before claiming done.'
  ].join(' ');
}
