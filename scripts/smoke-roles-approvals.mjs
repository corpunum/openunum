#!/usr/bin/env node

const API_URL = process.env.OPENUNUM_API_URL || 'http://127.0.0.1:18880';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getJson(path) {
  const res = await fetch(`${API_URL}${path}`);
  const json = await res.json();
  return { res, json };
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
  const roleList = await getJson('/api/roles');
  assert(roleList.res.ok, 'roles_list_failed');
  assert(roleList.json?.ok === true, 'roles_list_invalid_payload');
  assert(roleList.json?.roles && typeof roleList.json.roles === 'object', 'roles_map_missing');

  const approvalRequest = await postJson('/api/approvals/request', {
    toolName: 'shell_run',
    confidence: 0.31,
    tier: 'balanced',
    reason: 'smoke_test'
  });
  assert(approvalRequest.res.status === 201, 'approval_request_status_mismatch');
  const approvalId = String(approvalRequest.json?.approvalId || '');
  assert(Boolean(approvalId), 'approval_id_missing');

  const pending = await getJson('/api/approvals/pending');
  assert(pending.res.ok, 'approvals_pending_failed');
  assert(Array.isArray(pending.json?.pending), 'approvals_pending_invalid_payload');
  assert(pending.json.pending.some((row) => row.id === approvalId), 'approval_not_in_pending_list');

  const approve = await postJson(`/api/approvals/${approvalId}/approve`, {});
  assert(approve.res.ok, 'approval_approve_failed');
  assert(approve.json?.status === 'approved', 'approval_status_not_approved');

  const stats = await getJson('/api/approvals/stats');
  assert(stats.res.ok, 'approvals_stats_failed');
  assert(Number.isFinite(stats.json?.approved), 'approvals_stats_invalid_payload');

  console.log('✅ Roles/Approvals smoke test passed');
}

main().catch((err) => {
  console.error('❌ Roles/Approvals smoke failed:', err.message || err);
  process.exit(1);
});
