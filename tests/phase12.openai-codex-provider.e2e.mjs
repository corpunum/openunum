import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempHomes = [];

function makeTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-codex-oauth-'));
  tempHomes.push(home);
  fs.writeFileSync(path.join(home, 'secrets.json'), JSON.stringify({
    contract_version: '2026-04-01.secret-store.v1',
    updated_at: new Date().toISOString(),
    secrets: {
      openrouterApiKey: '',
      nvidiaApiKey: '',
      openaiApiKey: '',
      openaiOauthToken: 'oauth-access-token',
      githubToken: '',
      copilotGithubToken: '',
      huggingfaceApiKey: '',
      elevenlabsApiKey: '',
      telegramBotToken: ''
    },
    oauth: {
      openaiCodex: {
        access: 'oauth-access-token',
        refresh: 'oauth-refresh-token',
        expires: Date.now() + 3600000,
        accountId: 'acct-test',
        email: 'user@example.com',
        source: 'openunum'
      }
    }
  }, null, 2));
  return home;
}

const originalHome = process.env.OPENUNUM_HOME;

try {
  const oauthHome = makeTempHome();
  process.env.OPENUNUM_HOME = oauthHome;

  const { buildProvider } = await import('../src/providers/index.mjs');
  const { OpenAICodexOAuthProvider } = await import('../src/providers/openai-codex-oauth.mjs');
  const { OpenAICompatibleProvider } = await import('../src/providers/openai-compatible.mjs');

  const oauthSelected = buildProvider({
    model: {
      provider: 'openai',
      model: 'openai/gpt-5.4',
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiApiKey: ''
    },
    runtime: { providerRequestTimeoutMs: 5000 }
  });
  assert.equal(oauthSelected instanceof OpenAICodexOAuthProvider, true);

  const plainHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-codex-fallback-'));
  tempHomes.push(plainHome);
  process.env.OPENUNUM_HOME = plainHome;
  const apiKeySelected = buildProvider({
    model: {
      provider: 'openai',
      model: 'openai/gpt-4o-mini',
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiApiKey: 'sk-openai-test'
    },
    runtime: { providerRequestTimeoutMs: 5000 }
  });
  assert.equal(apiKeySelected instanceof OpenAICompatibleProvider, true);

  process.env.OPENUNUM_HOME = oauthHome;
  let savedCredentials = null;
  let seenModel = null;
  let seenContext = null;
  let seenOptions = null;
  const provider = new OpenAICodexOAuthProvider({
    model: 'gpt-5.4',
    timeoutMs: 5000,
    getOAuthApiKeyFn: async (providerId, credentials) => {
      assert.equal(providerId, 'openai-codex');
      assert.equal(typeof credentials['openai-codex']?.refresh, 'string');
      return {
        apiKey: 'oauth-access-token-refreshed',
        newCredentials: {
          access: 'oauth-access-token-refreshed',
          refresh: 'oauth-refresh-token-refreshed',
          expires: Date.now() + 7200000,
          accountId: 'acct-test'
        }
      };
    },
    saveCredentialsFn: (credentials) => {
      savedCredentials = credentials;
      return credentials;
    },
    streamFn: (model, context, options) => {
      seenModel = model;
      seenContext = context;
      seenOptions = options;
      return {
        result: async () => ({
          stopReason: 'toolUse',
          content: [
            { type: 'text', text: 'Codex says hi' },
            { type: 'toolCall', id: 'call-1|fc_1', name: 'shell_run', arguments: { cmd: 'pwd' } }
          ]
        })
      };
    }
  });

  const result = await provider.chat({
    messages: [
      { role: 'system', content: 'Primary system instruction' },
      { role: 'system', content: 'Continue until tool evidence exists' },
      { role: 'user', content: 'Inspect the workspace' },
      {
        role: 'assistant',
        content: 'I will inspect it.',
        tool_calls: [
          {
            id: 'prev-1|fc_prev',
            function: {
              name: 'file_read',
              arguments: '{"path":"/tmp/example.txt"}'
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'prev-1|fc_prev',
        content: '{"ok":true,"content":"example"}'
      }
    ],
    tools: [
      {
        name: 'shell_run',
        description: 'Run a command',
        parameters: { type: 'object', properties: { cmd: { type: 'string' } } }
      }
    ]
  });

  assert.equal(result.content, 'Codex says hi');
  assert.deepEqual(result.toolCalls, [
    {
      id: 'call-1|fc_1',
      name: 'shell_run',
      arguments: '{"cmd":"pwd"}'
    }
  ]);
  assert.equal(seenModel.id, 'gpt-5.4');
  assert.equal(seenModel.provider, 'openai-codex');
  assert.equal(seenContext.systemPrompt.includes('Primary system instruction'), true);
  assert.equal(seenContext.systemPrompt.includes('Continue until tool evidence exists'), true);
  assert.equal(seenContext.messages.some((message) => message.role === 'assistant'), true);
  assert.equal(seenContext.messages.some((message) => message.role === 'toolResult' && message.toolCallId === 'prev-1|fc_prev'), true);
  assert.equal(seenOptions.apiKey, 'oauth-access-token-refreshed');
  assert.equal(savedCredentials.accountId, 'acct-test');
  assert.equal(savedCredentials.source, 'openunum');

  console.log('phase12.openai-codex-provider.e2e: ok');
} finally {
  if (originalHome == null) delete process.env.OPENUNUM_HOME;
  else process.env.OPENUNUM_HOME = originalHome;
  for (const home of tempHomes) {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
