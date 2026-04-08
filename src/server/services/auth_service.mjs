import {
  getStoredOpenAICodexOAuth,
  getEffectiveOpenAICodexOAuthStatus,
  getStoredGoogleWorkspaceOAuth,
  getEffectiveGoogleWorkspaceOAuthStatus,
  getGoogleWorkspaceOAuthConfig,
  secretPreview,
  loadSecretStore,
  scanLocalAuthSources,
  getCliAuthStatus,
  getSecretsPath,
  getSecretStoreStatus,
  AUTH_CATALOG_CONTRACT_VERSION,
  AUTH_TARGET_DEFS
} from '../../secrets/store.mjs';
import { normalizeProviderId, fetchOllamaModels, fetchNvidiaModels, fetchOpenRouterModels, fetchOpenAIModels, buildModelCatalog } from '../../models/catalog.mjs';
import { spawn, execSync } from 'node:child_process';

export function createAuthService({ config, PROVIDER_ORDER, reloadConfigSecrets }) {
  function buildAuthMethodRows(store, scan, cliStatus) {
    const secrets = store.secrets || {};
    const storedOpenAiOauth = getStoredOpenAICodexOAuth(store);
    const effectiveOpenAiOauth = getEffectiveOpenAICodexOAuthStatus();
    const storedGoogleOauth = getStoredGoogleWorkspaceOAuth(store);
    const effectiveGoogleOauth = getEffectiveGoogleWorkspaceOAuthStatus();
    const googleOauthConfig = getGoogleWorkspaceOAuthConfig(store);
    return [
      {
        id: 'github',
        display_name: 'GitHub',
        auth_kind: 'token_or_oauth',
        configured: Boolean(secrets.githubToken || cliStatus.github?.authenticated),
        stored: Boolean(secrets.githubToken),
        stored_preview: secretPreview(secrets.githubToken),
        discovered: Boolean(scan.secrets.githubToken),
        discovered_source: scan.sourceMap.githubToken || null,
        cli: cliStatus.github
      },
      {
        id: 'google-workspace',
        display_name: 'Google Workspace',
        auth_kind: 'oauth_native',
        configured: Boolean(effectiveGoogleOauth.active),
        stored: Boolean(storedGoogleOauth?.access),
        stored_preview: secretPreview(storedGoogleOauth?.access),
        discovered: Boolean(scan.oauthConfigs?.googleWorkspaceClientId),
        discovered_source: scan.sourceMap.googleWorkspaceClientId || null,
        cli: {
          cli: 'openunum',
          available: Boolean(googleOauthConfig.clientId),
          authenticated: Boolean(effectiveGoogleOauth.active),
          account: effectiveGoogleOauth.active?.email || null,
          detail: effectiveGoogleOauth.active
            ? 'authenticated'
            : (googleOauthConfig.clientId ? 'client_id_saved' : 'client_id_missing')
        },
        oauth_client_id: googleOauthConfig.clientId || '',
        oauth_client_id_preview: secretPreview(googleOauthConfig.clientId),
        oauth_client_secret_preview: secretPreview(googleOauthConfig.clientSecret),
        oauth_scopes: googleOauthConfig.scopes
      },
      {
        id: 'huggingface',
        display_name: 'HuggingFace',
        auth_kind: 'api_key_or_cli',
        configured: Boolean(secrets.huggingfaceApiKey || cliStatus.huggingface?.authenticated),
        stored: Boolean(secrets.huggingfaceApiKey),
        stored_preview: secretPreview(secrets.huggingfaceApiKey),
        discovered: Boolean(scan.secrets.huggingfaceApiKey),
        discovered_source: scan.sourceMap.huggingfaceApiKey || null,
        cli: cliStatus.huggingface
      },
      {
        id: 'elevenlabs',
        display_name: 'ElevenLabs',
        auth_kind: 'api_key',
        configured: Boolean(secrets.elevenlabsApiKey),
        stored: Boolean(secrets.elevenlabsApiKey),
        stored_preview: secretPreview(secrets.elevenlabsApiKey),
        discovered: Boolean(scan.secrets.elevenlabsApiKey),
        discovered_source: scan.sourceMap.elevenlabsApiKey || null,
        cli: cliStatus.elevenlabs
      },
      {
        id: 'telegram',
        display_name: 'Telegram',
        auth_kind: 'bot_token',
        configured: Boolean(secrets.telegramBotToken),
        stored: Boolean(secrets.telegramBotToken),
        stored_preview: secretPreview(secrets.telegramBotToken),
        discovered: Boolean(scan.secrets.telegramBotToken),
        discovered_source: scan.sourceMap.telegramBotToken || null,
        cli: null
      },
      {
        id: 'openai-oauth',
        display_name: 'OpenAI Codex OAuth',
        auth_kind: 'oauth_native',
        configured: Boolean(effectiveOpenAiOauth.active),
        stored: Boolean(storedOpenAiOauth?.access),
        stored_preview: secretPreview(storedOpenAiOauth?.access || secrets.openaiOauthToken),
        discovered: Boolean(scan.secrets.openaiOauthToken),
        discovered_source: scan.sourceMap.openaiOauthToken || null,
        cli: cliStatus.openclaw
      },
      {
        id: 'github-copilot',
        display_name: 'GitHub Copilot',
        auth_kind: 'token',
        configured: Boolean(secrets.copilotGithubToken),
        stored: Boolean(secrets.copilotGithubToken),
        stored_preview: secretPreview(secrets.copilotGithubToken),
        discovered: Boolean(scan.secrets.copilotGithubToken),
        discovered_source: scan.sourceMap.copilotGithubToken || null,
        cli: null
      }
    ];
  }

  const PROVIDER_SECRET_FIELD = {
    ollama: null,
    nvidia: 'nvidiaApiKey',
    openrouter: 'openrouterApiKey',
    openai: 'openaiApiKey'
  };

  const PROVIDER_BASE_FIELD = {
    ollama: 'ollamaBaseUrl',
    nvidia: 'nvidiaBaseUrl',
    openrouter: 'openrouterBaseUrl',
    openai: 'openaiBaseUrl'
  };

  function providerConnectionOverrides(provider, body = {}) {
    const normalized = normalizeProviderId(provider);
    const baseField = PROVIDER_BASE_FIELD[normalized];
    const secretField = PROVIDER_SECRET_FIELD[normalized];
    return {
      provider: normalized,
      baseUrl: String(body.baseUrl || config.model?.[baseField] || '').trim(),
      apiKey: secretField ? String(body.apiKey || config.model?.[secretField] || '').trim() : ''
    };
  }

  function secretForService(service, providedSecret = '') {
    const secret = String(providedSecret || '').trim();
    if (secret) return secret;
    const store = loadSecretStore();
    const secrets = store.secrets || {};
    const scan = scanLocalAuthSources();
    if (service === 'github') return String(secrets.githubToken || '').trim();
    if (service === 'huggingface') return String(secrets.huggingfaceApiKey || '').trim();
    if (service === 'elevenlabs') return String(secrets.elevenlabsApiKey || '').trim();
    if (service === 'telegram') return String(secrets.telegramBotToken || '').trim();
    if (service === 'openai-oauth') return String(secrets.openaiOauthToken || scan.secrets.openaiOauthToken || '').trim();
    if (service === 'github-copilot') return String(secrets.copilotGithubToken || '').trim();
    return '';
  }

  async function testProviderConnection({ provider, baseUrl, apiKey }) {
    const normalized = normalizeProviderId(provider);
    let models = [];
    if (normalized === 'ollama') models = await fetchOllamaModels(baseUrl);
    else if (normalized === 'nvidia') models = await fetchNvidiaModels(baseUrl, apiKey);
    else if (normalized === 'openrouter') models = await fetchOpenRouterModels(baseUrl, apiKey);
    else models = await fetchOpenAIModels(baseUrl, apiKey);
    return {
      ok: true,
      provider: normalized,
      modelCount: models.length,
      topModel: models[0]?.model_id || null,
      status: 'healthy'
    };
  }

  async function testServiceConnection({ service, secret }) {
    const id = String(service || '').trim().toLowerCase();
    const cli = getCliAuthStatus();
    if (id === 'github') {
      if (secret) {
        const res = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${secret}`,
            'User-Agent': 'openunum'
          },
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) throw new Error(`github_test_failed:${res.status}`);
        const data = await res.json();
        return { ok: true, service: id, status: 'authenticated', account: data.login || null };
      }
      return {
        ok: Boolean(cli.github?.authenticated),
        service: id,
        status: cli.github?.authenticated ? 'authenticated' : (cli.github?.available ? 'available' : 'unavailable'),
        account: cli.github?.account || null,
        detail: cli.github?.detail || null
      };
    }
    if (id === 'google-workspace') {
      const googleClient = new (await import('../../tools/google-workspace.mjs')).GoogleWorkspaceClient(config);
      const status = await googleClient.status();
      return {
        ok: Boolean(status.authenticated),
        service: id,
        status: status.authenticated ? 'authenticated' : (status.installed ? 'available' : 'unavailable'),
        account: status.account || null,
        detail: status.detail || null,
        prerequisite: status.installed ? null : status.hint || 'Save a Google OAuth Desktop Client ID first.'
      };
    }
    if (id === 'huggingface') {
      if (secret) {
        const res = await fetch('https://huggingface.co/api/whoami-v2', {
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) throw new Error(`huggingface_test_failed:${res.status}`);
        const data = await res.json();
        return { ok: true, service: id, status: 'authenticated', account: data.name || data.fullname || null };
      }
      return {
        ok: Boolean(cli.huggingface?.authenticated),
        service: id,
        status: cli.huggingface?.authenticated ? 'authenticated' : (cli.huggingface?.available ? 'available' : 'unavailable'),
        account: cli.huggingface?.account || null,
        detail: cli.huggingface?.detail || null
      };
    }
    if (id === 'elevenlabs') {
      if (!secret) {
        return {
          ok: false,
          service: id,
          status: cli.elevenlabs?.available ? 'available' : 'unavailable',
          detail: cli.elevenlabs?.detail || 'secret_required'
        };
      }
      const res = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': secret },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) throw new Error(`elevenlabs_test_failed:${res.status}`);
      const data = await res.json();
      return { ok: true, service: id, status: 'authenticated', account: data.subscription?.tier || data.email || null };
    }
    if (id === 'telegram') {
      if (!secret) throw new Error('telegram_token_missing');
      const res = await fetch(`https://api.telegram.org/bot${secret}/getMe`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`telegram_test_failed:${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(`telegram_test_failed:${data.description || 'unknown'}`);
      return { ok: true, service: id, status: 'authenticated', account: data.result?.username || data.result?.first_name || null };
    }
    if (id === 'openai-oauth') {
      if (!secret) throw new Error('openai_oauth_token_missing');
      const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) throw new Error(`openai_oauth_test_failed:${res.status}`);
      const data = await res.json();
      return {
        ok: true,
        service: id,
        status: 'authenticated',
        account: data.plan_type || null,
        detail: data.rate_limit?.primary_window ? 'usage endpoint reachable' : 'oauth token accepted'
      };
    }
    if (id === 'github-copilot') {
      if (!secret) throw new Error('copilot_token_missing');
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${secret}`,
          'User-Agent': 'openunum'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) throw new Error(`github_copilot_test_failed:${res.status}`);
      const data = await res.json();
      return { ok: true, service: id, status: 'authenticated', account: data.login || null };
    }
    throw new Error(`unsupported_service:${id}`);
  }

  function oauthCommandForService(service) {
    const id = String(service || '').trim().toLowerCase();
    if (id === 'github') return 'gh auth login -w';
    if (id === 'openai-oauth') return 'openclaw models auth login --provider openai-codex';
    return null;
  }

  function launchInTerminal(cmd) {
    const wrapped = `${cmd}; printf '\\n'; read -r -p 'Press Enter to close...' _`;
    const candidates = [
      ['x-terminal-emulator', ['-e', 'bash', '-lc', wrapped]],
      ['gnome-terminal', ['--', 'bash', '-lc', wrapped]]
    ];
    for (const [bin, args] of candidates) {
      try {
        execSync(`command -v ${bin}`, { stdio: 'ignore' });
      } catch {
        continue;
      }
      try {
        const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: true, started: true, command: cmd, launcher: bin, pid: child.pid };
      } catch {
        continue;
      }
    }
    return { ok: false, started: false, error: 'terminal_not_available', command: cmd };
  }

  function launchOauthCommand(service) {
    const cmd = oauthCommandForService(service);
    if (!cmd) return { ok: false, started: false, error: 'oauth_not_supported' };
    const cli = getCliAuthStatus();
    if (service === 'github' && !cli.github?.available) return { ok: false, started: false, error: 'gh_not_available' };
    if (service === 'openai-oauth' && !cli.openclaw?.available) {
      return {
        ok: false,
        started: false,
        error: 'openclaw_not_available',
        prerequisite: 'Install or expose the `openclaw` CLI to launch the OpenAI Codex OAuth flow.'
      };
    }
    return launchInTerminal(cmd);
  }

  async function buildAuthCatalogPayload(memory = null) {
    reloadConfigSecrets();
    const [catalog] = await Promise.all([buildModelCatalog(config.model, memory)]);
    const store = loadSecretStore();
    const scan = scanLocalAuthSources();
    const cliStatus = getCliAuthStatus();
    const effectiveOpenAiOauth = getEffectiveOpenAICodexOAuthStatus();

    return {
      contract_version: AUTH_CATALOG_CONTRACT_VERSION,
      secret_store_path: getSecretsPath(),
      secret_store: getSecretStoreStatus(),
      provider_order: [...PROVIDER_ORDER],
      auth_targets: AUTH_TARGET_DEFS,
      scanned_files: scan.filesScanned,
      providers: catalog.providers.map((provider) => {
        const keyField = PROVIDER_SECRET_FIELD[provider.provider];
        const baseField = PROVIDER_BASE_FIELD[provider.provider];
        const storedValue = keyField ? store.secrets?.[keyField] : '';
        const discoveredValue = keyField ? scan.secrets?.[keyField] : '';
        const disabledProviders = config.model?.routing?.disabledProviders || [];
        return {
          provider: provider.provider,
          display_name: provider.display_name,
          auth_kind: provider.provider === 'ollama' ? 'none' : 'api_key',
          selected: catalog.selected?.provider === provider.provider,
          disabled: disabledProviders.includes(provider.provider),
          status: provider.status,
          degraded_reason: provider.degraded_reason,
          base_url: config.model?.[baseField] || null,
          base_url_source: scan.sourceMap?.[baseField] || null,
          model_count: provider.models?.length || 0,
          top_model: provider.models?.[0]?.model_id || null,
          top_model_rank: provider.models?.[0]?.rank || null,
          stored: Boolean(storedValue),
          stored_preview: secretPreview(storedValue),
          discovered: Boolean(discoveredValue),
          discovered_source: keyField ? (scan.sourceMap?.[keyField] || null) : null,
          auth_ready: provider.provider === 'ollama'
            ? true
            : provider.provider === 'openai'
              ? Boolean(config.model?.[keyField] || effectiveOpenAiOauth.active)
              : Boolean(config.model?.[keyField]),
          auth_mode: provider.provider === 'openai' && effectiveOpenAiOauth.active && !config.model?.[keyField]
            ? 'oauth'
            : (provider.provider === 'ollama' ? 'none' : 'api_key')
        };
      }),
      auth_methods: buildAuthMethodRows(store, scan, cliStatus)
    };
  }

  return {
    buildAuthMethodRows,
    providerConnectionOverrides,
    secretForService,
    testProviderConnection,
    testServiceConnection,
    oauthCommandForService,
    launchInTerminal,
    launchOauthCommand,
    buildAuthCatalogPayload
  };
}
