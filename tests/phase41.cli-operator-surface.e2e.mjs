import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { startServer, stopServer, jpost } from './_helpers.mjs';

const DEFAULT_DYNAMIC_PORT = 18000 + (process.pid % 2000);
const TEST_PORT = Number(process.env.OPENUNUM_TEST_PORT || DEFAULT_DYNAMIC_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function runCli(args, extraEnv = {}) {
  const out = spawnSync('node', ['src/cli.mjs', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENUNUM_BASE_URL: BASE_URL,
      ...extraEnv
    },
    encoding: 'utf8',
    timeout: 15000,
    killSignal: 'SIGKILL'
  });
  if (out.error && String(out.error.code || '') === 'ETIMEDOUT') {
    throw new Error(`cli_timeout args=${args.join(' ')}`);
  }
  if (out.status !== 0) {
    throw new Error(`cli_failed args=${args.join(' ')} stderr=${out.stderr || out.stdout}`);
  }
  const raw = String(out.stdout || '').trim();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`cli_non_json_output args=${args.join(' ')} out=${raw}`);
  }
}

let proc;
try {
  proc = await startServer();

  const runtime = runCli(['runtime', 'status']);
  assert.equal(runtime.ok, true);
  assert.equal(typeof runtime.selectedModel?.provider, 'string');

  const providers = runCli(['providers', 'catalog']);
  assert.equal(Array.isArray(providers.providers), true);
  assert.equal(providers.providers.length > 0, true);

  const providerHealth = runCli(['providers', 'health']);
  assert.equal(providerHealth.ok, true);
  assert.equal(Array.isArray(providerHealth.providers), true);
  assert.equal(typeof providerHealth.summary?.totalProviders, 'number');

  const auth = runCli(['auth', 'catalog']);
  assert.equal(typeof auth.contract_version, 'string');

  const missions = runCli(['missions', 'list']);
  assert.equal(Array.isArray(missions.missions), true);
  assert.equal(typeof missions.summary?.total, 'number');

  const startedMission = await jpost('/api/missions/start', {
    goal: 'phase41 cli mission diagnostics',
    maxSteps: 1,
    intervalMs: 50
  });
  assert.equal(startedMission.status, 200);
  const missionId = String(startedMission.json.id || '').trim();
  assert.equal(Boolean(missionId), true);

  const missionStatus = runCli(['missions', 'status', '--id', missionId, '--with-timeline']);
  assert.equal(typeof missionStatus.mission?.id, 'string');
  assert.equal(typeof missionStatus.timeline?.mission?.id, 'string');

  const missionTimeline = runCli(['missions', 'timeline', '--id', missionId]);
  assert.equal(typeof missionTimeline.mission?.id, 'string');

  const sessionId = `phase41-cli-${Date.now()}`;
  const created = await jpost('/api/sessions', { sessionId });
  assert.equal(created.status, 200);

  const sessions = runCli(['sessions', 'list', '--limit', '200']);
  assert.equal(Array.isArray(sessions.sessions), true);
  assert.equal(sessions.sessions.some((row) => String(row.sessionId || '') === sessionId), true);

  const deleted = runCli(['sessions', 'delete', '--id', sessionId]);
  assert.equal(deleted.ok, true);

  console.log('phase41.cli-operator-surface.e2e: ok');
} finally {
  await stopServer(proc);
}
