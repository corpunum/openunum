import { spawn } from 'node:child_process';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function openUrlInDesktopBrowser(url) {
  try {
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return { opened: true };
  } catch {
    return { opened: false };
  }
}

export function createAuthJobsService({
  config,
  agent,
  getGoogleWorkspaceOAuthConfig,
  validateGoogleWorkspaceOAuthConfig,
  createGoogleWorkspacePkce,
  buildGoogleWorkspaceRedirectUri,
  buildGoogleWorkspaceAuthUrl,
  GOOGLE_WORKSPACE_DEFAULT_SCOPES,
  exchangeGoogleWorkspaceAuthorizationCode,
  fetchGoogleWorkspaceUser,
  saveGoogleWorkspaceOAuth,
  saveOpenAICodexOAuth,
  launchOauthCommand
}) {
  const authJobs = new Map();

  function pruneAuthJobs() {
    const cutoff = Date.now() - (30 * 60 * 1000);
    for (const [id, job] of authJobs.entries()) {
      if ((job.updatedAt || 0) < cutoff) authJobs.delete(id);
    }
  }

  function summarizeAuthJob(job) {
    if (!job) return null;
    return {
      id: job.id,
      service: job.service,
      status: job.status,
      progress: job.progress || null,
      authUrl: job.authUrl || null,
      browserOpened: Boolean(job.browserOpened),
      promptMessage: job.promptMessage || null,
      error: job.error || null,
      account: job.account || null,
      source: job.source || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };
  }

  async function waitForAuthUrl(job, timeoutMs = 1500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (job.authUrl || job.status === 'failed' || job.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function startOpenAICodexOAuthJob() {
    pruneAuthJobs();
    const id = crypto.randomUUID();
    const manualInput = createDeferred();
    const job = {
      id,
      service: 'openai-oauth',
      status: 'starting',
      progress: 'starting oauth',
      authUrl: null,
      browserOpened: false,
      promptMessage: null,
      error: null,
      account: null,
      source: 'openunum',
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
      manualInput
    };
    authJobs.set(id, job);

    (async () => {
      try {
        const { loginOpenAICodex } = await import('@mariozechner/pi-ai/oauth');
        const creds = await loginOpenAICodex({
          onAuth: (info) => {
            job.status = 'awaiting_browser';
            job.authUrl = info?.url || null;
            job.progress = info?.instructions || 'Open the browser to continue OAuth';
            job.updatedAt = Date.now();
            if (job.authUrl) {
              const opened = openUrlInDesktopBrowser(job.authUrl);
              job.browserOpened = opened.opened;
            }
          },
          onProgress: (message) => {
            job.progress = String(message || '').trim() || job.progress;
            job.updatedAt = Date.now();
          },
          onPrompt: async (prompt) => {
            job.status = 'awaiting_input';
            job.promptMessage = prompt?.message || 'Paste the authorization code or redirect URL';
            job.updatedAt = Date.now();
            return await manualInput.promise;
          },
          onManualCodeInput: async () => {
            job.status = 'awaiting_input';
            job.promptMessage = 'Paste the authorization code or full redirect URL';
            job.updatedAt = Date.now();
            return await manualInput.promise;
          }
        });
        saveOpenAICodexOAuth({ ...creds, source: 'openunum' });
        job.status = 'completed';
        job.progress = 'oauth complete';
        job.account = creds?.email || creds?.accountId || null;
        job.updatedAt = Date.now();
      } catch (error) {
        job.status = 'failed';
        job.error = String(error.message || error);
        job.updatedAt = Date.now();
      }
    })();

    await waitForAuthUrl(job);
    return { ok: true, started: true, job: summarizeAuthJob(job) };
  }

  async function startGoogleWorkspaceOAuthJob() {
    pruneAuthJobs();
    const oauthConfig = getGoogleWorkspaceOAuthConfig();
    const validation = validateGoogleWorkspaceOAuthConfig(oauthConfig);
    if (!validation.ok) return { ok: false, started: false, ...validation };
    const id = crypto.randomUUID();
    const { verifier, challenge, state } = createGoogleWorkspacePkce();
    const redirectUri = buildGoogleWorkspaceRedirectUri(config.server);
    const authUrl = buildGoogleWorkspaceAuthUrl({
      clientId: oauthConfig.clientId,
      redirectUri,
      scopes: oauthConfig.scopes || GOOGLE_WORKSPACE_DEFAULT_SCOPES.join(' '),
      state,
      challenge
    });
    const job = {
      id,
      service: 'google-workspace',
      status: 'awaiting_browser',
      progress: 'Open the browser and approve Google Workspace access',
      authUrl,
      browserOpened: false,
      promptMessage: null,
      error: null,
      account: null,
      source: 'openunum',
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
      state,
      verifier,
      redirectUri,
      clientId: oauthConfig.clientId,
      clientSecret: oauthConfig.clientSecret || '',
      scopes: oauthConfig.scopes || GOOGLE_WORKSPACE_DEFAULT_SCOPES.join(' ')
    };
    authJobs.set(id, job);
    const opened = openUrlInDesktopBrowser(authUrl);
    job.browserOpened = opened.opened;
    return { ok: true, started: true, job: summarizeAuthJob(job) };
  }

  function findGoogleWorkspaceAuthJobByState(state) {
    pruneAuthJobs();
    const expected = String(state || '').trim();
    if (!expected) return null;
    for (const job of authJobs.values()) {
      if (job.service === 'google-workspace' && String(job.state || '').trim() === expected) return job;
    }
    return null;
  }

  async function completeGoogleWorkspaceAuthJob(job, code) {
    const token = await exchangeGoogleWorkspaceAuthorizationCode({
      clientId: job.clientId,
      clientSecret: job.clientSecret,
      code,
      verifier: job.verifier,
      redirectUri: job.redirectUri
    });
    let email = '';
    try {
      const user = await fetchGoogleWorkspaceUser(token.access_token);
      email = String(user?.email || '').trim();
    } catch {
      email = '';
    }
    saveGoogleWorkspaceOAuth({
      access: token.access_token,
      refresh: token.refresh_token,
      expires: Date.now() + (Number(token.expires_in || 3600) * 1000),
      email,
      scope: String(token.scope || job.scopes || '').trim(),
      tokenType: String(token.token_type || 'Bearer').trim() || 'Bearer',
      source: 'openunum'
    });
    job.status = 'completed';
    job.progress = 'oauth complete';
    job.account = email || null;
    job.updatedAt = Date.now();
  }

  function getAuthJob(id) {
    pruneAuthJobs();
    return authJobs.get(String(id || '').trim()) || null;
  }

  function completeAuthJob(id, input) {
    const job = getAuthJob(id);
    if (!job) return { ok: false, error: 'auth_job_not_found' };
    if (!job.manualInput?.resolve) return { ok: false, error: 'auth_job_not_waiting_for_input' };
    job.promptMessage = null;
    job.progress = 'processing authorization code';
    job.status = 'processing_input';
    job.updatedAt = Date.now();
    job.manualInput.resolve(String(input || '').trim());
    return { ok: true, accepted: true, job: summarizeAuthJob(job) };
  }

  async function connectService(service) {
    const normalized = String(service || '').trim().toLowerCase();
    if (normalized === 'openai-oauth') return await startOpenAICodexOAuthJob();
    if (normalized === 'google-workspace') return await startGoogleWorkspaceOAuthJob();
    return launchOauthCommand(service);
  }

  return {
    authJobs,
    pruneAuthJobs,
    summarizeAuthJob,
    startOpenAICodexOAuthJob,
    startGoogleWorkspaceOAuthJob,
    findGoogleWorkspaceAuthJobByState,
    completeGoogleWorkspaceAuthJob,
    getAuthJob,
    completeAuthJob,
    connectService
  };
}

