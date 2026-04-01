import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalHome = process.env.OPENUNUM_HOME;
const originalFetch = global.fetch;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-google-native-'));

try {
  process.env.OPENUNUM_HOME = testHome;

  const {
    saveGoogleWorkspaceOAuth,
    saveGoogleWorkspaceOAuthConfig,
    loadSecretStore
  } = await import('../src/secrets/store.mjs');
  const { GoogleWorkspaceClient } = await import('../src/tools/google-workspace.mjs');

  saveGoogleWorkspaceOAuthConfig({
    clientId: 'google-client-id.apps.googleusercontent.com',
    clientSecret: 'google-client-secret',
    scopes: 'openid email profile https://www.googleapis.com/auth/gmail.modify'
  });
  saveGoogleWorkspaceOAuth({
    access: 'expired-access',
    refresh: 'refresh-token',
    expires: Date.now() - 1000,
    email: '',
    scope: 'openid email profile https://www.googleapis.com/auth/gmail.modify',
    tokenType: 'Bearer',
    source: 'openunum'
  });

  const seen = [];
  global.fetch = async (url, init = {}) => {
    const target = String(url);
    seen.push({ url: target, method: init.method || 'GET' });
    if (target === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid email profile https://www.googleapis.com/auth/gmail.modify'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target === 'https://openidconnect.googleapis.com/v1/userinfo') {
      assert.equal(init.headers.Authorization, 'Bearer fresh-access-token');
      return new Response(JSON.stringify({
        email: 'user@example.com'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
      assert.equal(init.headers.Authorization, 'Bearer fresh-access-token');
      return new Response(JSON.stringify({
        messages: [{ id: 'msg-1' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-1?format=full') {
      assert.equal(init.headers.Authorization, 'Bearer fresh-access-token');
      return new Response(JSON.stringify({
        id: 'msg-1',
        snippet: 'hello'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer fresh-access-token');
      const body = JSON.parse(init.body);
      assert.equal(typeof body.raw, 'string');
      return new Response(JSON.stringify({
        id: 'sent-1'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  const client = new GoogleWorkspaceClient({});
  const status = await client.status();
  assert.equal(status.authenticated, true);
  assert.equal(status.account, 'user@example.com');

  const listed = await client.gmailList({ limit: 5, query: 'label:inbox' });
  assert.equal(listed.ok, true);
  assert.equal(listed.data.messages[0].id, 'msg-1');

  const read = await client.gmailRead({ id: 'msg-1', format: 'full' });
  assert.equal(read.ok, true);
  assert.equal(read.data.id, 'msg-1');

  const sent = await client.gmailSend({ to: 'a@example.com', subject: 'Hello', body: 'World' });
  assert.equal(sent.ok, true);
  assert.equal(sent.data.id, 'sent-1');

  const store = loadSecretStore();
  assert.equal(store.oauth.googleWorkspace.access, 'fresh-access-token');
  assert.equal(store.oauth.googleWorkspace.refresh, 'fresh-refresh-token');
  assert.equal(store.oauth.googleWorkspace.email, 'user@example.com');
  assert.equal(seen.some((call) => call.url === 'https://oauth2.googleapis.com/token'), true);

  console.log('phase13.google-workspace-native.e2e: ok');
} finally {
  global.fetch = originalFetch;
  if (originalHome == null) delete process.env.OPENUNUM_HOME;
  else process.env.OPENUNUM_HOME = originalHome;
  fs.rmSync(testHome, { recursive: true, force: true });
}
