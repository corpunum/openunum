import crypto from 'node:crypto';

export const RUNTIME_STATE_CONTRACT_VERSION = '2026-04-08.runtime-state.v1';

const DEFAULT_STATE = {
  contractVersion: RUNTIME_STATE_CONTRACT_VERSION,
  sessionId: '',
  goal: '',
  phase: 'unknown',
  nextAction: '',
  verifiedObservations: [],
  permissions: {
    shell: false,
    network: false,
    browser: false,
    fileWrite: false
  },
  blockers: [],
  activeArtifacts: [],
  metadata: {},
  updatedAt: ''
};

function toCleanString(value) {
  return String(value || '').trim();
}

function toUniqueStringList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const text = toCleanString(item);
    if (!text) continue;
    if (out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

function toPermissions(raw = {}) {
  return {
    shell: Boolean(raw.shell),
    network: Boolean(raw.network),
    browser: Boolean(raw.browser),
    fileWrite: Boolean(raw.fileWrite)
  };
}

function sortedClone(value) {
  if (Array.isArray(value)) return value.map((item) => sortedClone(item));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortedClone(value[key]);
  }
  return out;
}

export function createCanonicalRuntimeState(input = {}) {
  const next = {
    ...DEFAULT_STATE,
    ...input,
    contractVersion: RUNTIME_STATE_CONTRACT_VERSION,
    sessionId: toCleanString(input.sessionId),
    goal: toCleanString(input.goal),
    phase: toCleanString(input.phase || DEFAULT_STATE.phase).toLowerCase(),
    nextAction: toCleanString(input.nextAction),
    verifiedObservations: toUniqueStringList(input.verifiedObservations),
    permissions: toPermissions(input.permissions),
    blockers: toUniqueStringList(input.blockers),
    activeArtifacts: toUniqueStringList(input.activeArtifacts),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? { ...input.metadata }
      : {},
    updatedAt: toCleanString(input.updatedAt) || new Date().toISOString()
  };

  return next;
}

export function validateCanonicalRuntimeState(state) {
  const errors = [];
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, errors: ['state must be an object'] };
  }

  if (state.contractVersion !== RUNTIME_STATE_CONTRACT_VERSION) {
    errors.push(`contractVersion must equal ${RUNTIME_STATE_CONTRACT_VERSION}`);
  }

  if (!toCleanString(state.goal)) {
    errors.push('goal is required');
  }

  if (!toCleanString(state.nextAction)) {
    errors.push('nextAction is required');
  }

  if (!toCleanString(state.updatedAt)) {
    errors.push('updatedAt is required');
  }

  if (!state.permissions || typeof state.permissions !== 'object' || Array.isArray(state.permissions)) {
    errors.push('permissions must be an object');
  } else {
    for (const key of ['shell', 'network', 'browser', 'fileWrite']) {
      if (typeof state.permissions[key] !== 'boolean') {
        errors.push(`permissions.${key} must be boolean`);
      }
    }
  }

  for (const key of ['verifiedObservations', 'blockers', 'activeArtifacts']) {
    if (!Array.isArray(state[key])) {
      errors.push(`${key} must be an array`);
      continue;
    }
    for (const item of state[key]) {
      if (!toCleanString(item)) {
        errors.push(`${key} contains empty value`);
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function computeRuntimeStateFingerprint(state) {
  const stableUpdatedAt = toCleanString(state?.updatedAt) || '1970-01-01T00:00:00.000Z';
  const canonical = sortedClone(
    createCanonicalRuntimeState({
      ...state,
      updatedAt: stableUpdatedAt
    })
  );
  const payload = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function buildRuntimeStatePacket(state, extras = {}) {
  const canonicalState = createCanonicalRuntimeState(state);
  return {
    contractVersion: RUNTIME_STATE_CONTRACT_VERSION,
    fingerprint: computeRuntimeStateFingerprint(canonicalState),
    state: canonicalState,
    generatedAt: new Date().toISOString(),
    ...extras
  };
}
