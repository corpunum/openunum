export const CONTROL_PLANE_STATIC_ACTIONS = [
  { id: 'cpSelfHealDry', method: 'POST', path: '/api/self-heal', body: { dryRun: true } },
  { id: 'cpSelfHealFix', method: 'POST', path: '/api/self-heal/fix', body: {} },
  { id: 'cpSelfHealStatus', method: 'GET', path: '/api/selfheal/status' },
  { id: 'cpMasterStatus', method: 'GET', path: '/api/autonomy/master/status' },
  { id: 'cpMasterStart', method: 'POST', path: '/api/autonomy/master/start', body: {} },
  { id: 'cpMasterStop', method: 'POST', path: '/api/autonomy/master/stop', body: {} },
  { id: 'cpMasterCycle', method: 'POST', path: '/api/autonomy/master/cycle', body: {} },
  { id: 'cpMasterImprove', method: 'POST', path: '/api/autonomy/master/self-improve', body: {} },
  { id: 'cpMasterLearnSkills', method: 'POST', path: '/api/autonomy/master/learn-skills', body: {} },
  { id: 'cpMasterSelfTest', method: 'POST', path: '/api/autonomy/master/self-test', body: {} },
  { id: 'cpResearchRun', method: 'POST', path: '/api/research/run', body: { simulate: false } },
  { id: 'cpResearchRecent', method: 'GET', path: '/api/research/recent?limit=25' },
  { id: 'cpResearchQueue', method: 'GET', path: '/api/research/queue?limit=50' },
  { id: 'cpWorkersList', method: 'GET', path: '/api/autonomy/workers?limit=50' },
  { id: 'cpSelfEditRuns', method: 'GET', path: '/api/autonomy/self-edit?limit=25' },
  { id: 'cpModelScoutList', method: 'GET', path: '/api/autonomy/model-scout?limit=20' },
  { id: 'cpTaskList', method: 'GET', path: '/api/autonomy/tasks?limit=20' },
  { id: 'cpOpsRecent', method: 'GET', path: '/api/operations/recent?limit=50' }
];

export function bindControlPlaneStaticActions(getEl, run) {
  for (const action of CONTROL_PLANE_STATIC_ACTIONS) {
    const el = getEl(action.id);
    if (!el) continue;
    el.onclick = () => run(action.method, action.path, action.body);
  }
}

export function buildResearchApproveBody(url, note) {
  return {
    url: String(url || '').trim(),
    note: String(note || '').trim()
  };
}

export function buildModelScoutRunBody(query) {
  return {
    query: String(query || '').trim(),
    monitorLocal: true
  };
}

export function buildTaskRunBody(goal, origin) {
  return {
    goal: String(goal || '').trim(),
    plan: [
      'Inspect current runtime state',
      'Verify the service surface',
      'Record monitoring evidence'
    ],
    steps: [
      {
        kind: 'tool',
        label: 'inspect host',
        tool: 'shell_run',
        args: { cmd: 'uname -a' }
      },
      {
        kind: 'tool',
        label: 'verify health',
        tool: 'http_request',
        args: { url: `${origin}/api/health`, method: 'GET' }
      }
    ],
    verify: [
      { kind: 'step_ok', stepIndex: 0 },
      { kind: 'http', url: `${origin}/api/health`, expectStatus: 200 }
    ],
    monitor: [
      { kind: 'http', url: `${origin}/api/runtime/inventory`, expectStatus: 200 }
    ]
  };
}

export function parseControlPlaneBody(method, rawBody) {
  const methodUpper = String(method || 'GET').toUpperCase();
  const raw = String(rawBody || '').trim();
  if (methodUpper === 'GET' || !raw) return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, error: 'invalid JSON body' };
  }
}
