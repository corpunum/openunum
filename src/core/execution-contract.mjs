function normalize(text) {
  return String(text || '').toLowerCase();
}

export function isProofBackedDone({ text, toolRuns, requireProofForDone = true }) {
  const t = normalize(text);
  const claimsDone = /\b(done|completed|finished|mission_status:\s*done)\b/.test(t);
  if (!claimsDone) return false;
  if (!requireProofForDone) return true;
  return Number(toolRuns || 0) > 0;
}

export function shouldForceContinuation({
  assistantText,
  toolCalls,
  toolRuns,
  iteration,
  maxIters,
  priorForcedCount
}) {
  if (Array.isArray(toolCalls) && toolCalls.length > 0) return false;
  if (iteration >= maxIters) return false;
  if (Number(priorForcedCount || 0) >= 2) return false;
  if (Number(toolRuns || 0) <= 0) return false;
  const text = normalize(assistantText);
  if (!text.trim()) return true;
  if (isProofBackedDone({ text, toolRuns, requireProofForDone: true })) return false;
  return /plan|i will|next|let me|approach|strategy/.test(text);
}

export function continuationDirective(reason = 'continue_execution') {
  return [
    'Execution contract reminder:',
    '1. Do not stop at planning text.',
    '2. Continue with concrete tool actions now.',
    '3. Only produce DONE language when proof is present from tool results in this turn.',
    `Reason: ${reason}`
  ].join('\n');
}

export function recoveryDirective() {
  return [
    'Provide a concise final status update based only on completed tool results.',
    'Do not call tools.',
    'Include what succeeded, what failed, and next concrete step.',
    'If no proof exists for completion, explicitly say not done.'
  ].join(' ');
}
