/**
 * Agent Events — lightweight event bus for streaming agent activity to SSE clients.
 * Emits: content_delta, reasoning_delta, tool_call_started, tool_call_completed, tool_call_failed
 */

const listeners = new Map();

export function onAgentEvent(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => {
    const set = listeners.get(event);
    if (set) set.delete(handler);
  };
}

export function emitAgentEvent(event, data) {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of set) {
    try { handler(data); } catch { /* swallow listener errors */ }
  }
}

export function clearAgentEvents() {
  listeners.clear();
}

export const AGENT_EVENTS = {
  CONTENT_DELTA: 'content_delta',
  REASONING_DELTA: 'reasoning_delta',
  REASONING_START: 'reasoning_start',
  REASONING_END: 'reasoning_end',
  TOOL_CALL_STARTED: 'tool_call_started',
  TOOL_CALL_COMPLETED: 'tool_call_completed',
  TOOL_CALL_FAILED: 'tool_call_failed',
  TURN_END: 'turn_end'
};