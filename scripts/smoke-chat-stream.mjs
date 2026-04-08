#!/usr/bin/env node

const API_URL = process.env.OPENUNUM_API_URL || 'http://127.0.0.1:18880';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function postJson(path, payload) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  const json = await res.json();
  return { res, json };
}

async function main() {
  const sessionId = `smoke-stream-${Date.now()}`;
  const created = await postJson('/api/sessions', { sessionId });
  assert(created.res.ok, 'create_session_failed');

  const since = new Date(Date.now() - 10_000).toISOString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('stream_timeout')), 6000);

  try {
    const res = await fetch(
      `${API_URL}/api/chat/stream?sessionId=${encodeURIComponent(sessionId)}&since=${encodeURIComponent(since)}`,
      { signal: controller.signal }
    );
    assert(res.ok, 'stream_http_error');
    const contentType = String(res.headers.get('content-type') || '');
    assert(contentType.includes('text/event-stream'), 'stream_content_type_invalid');
    assert(res.body, 'stream_body_missing');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    assert(!first.done, 'stream_closed_early');
    const chunk = decoder.decode(first.value || new Uint8Array(), { stream: true });
    const line = String(chunk.split('\n').find((ln) => ln.startsWith('data: ')) || '');
    assert(Boolean(line), 'stream_data_line_missing');
    const payload = JSON.parse(line.slice(6));
    assert(payload.sessionId === sessionId, 'stream_session_mismatch');
    assert(typeof payload.pending === 'boolean', 'stream_pending_missing');
    assert(Array.isArray(payload.toolRuns), 'stream_toolruns_missing');
    assert(Array.isArray(payload.messages), 'stream_messages_missing');
    controller.abort();
    console.log('✅ Chat stream smoke test passed');
  } finally {
    clearTimeout(timeoutId);
  }
}

main().catch((error) => {
  console.error('❌ Chat stream smoke failed:', error.message || error);
  process.exit(1);
});
