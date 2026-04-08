import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSecretStore, saveSecretStore, getSecretStoreStatus } from '../../src/secrets/store.mjs';

describe('Secret Store Encryption Backend', () => {
  let tempHome;
  const originalHome = process.env.OPENUNUM_HOME;
  const originalBackend = process.env.OPENUNUM_SECRETS_BACKEND;
  const originalPassphrase = process.env.OPENUNUM_SECRETS_PASSPHRASE;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-secret-store-'));
    process.env.OPENUNUM_HOME = tempHome;
    delete process.env.OPENUNUM_SECRETS_BACKEND;
    delete process.env.OPENUNUM_SECRETS_PASSPHRASE;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OPENUNUM_HOME;
    else process.env.OPENUNUM_HOME = originalHome;
    if (originalBackend === undefined) delete process.env.OPENUNUM_SECRETS_BACKEND;
    else process.env.OPENUNUM_SECRETS_BACKEND = originalBackend;
    if (originalPassphrase === undefined) delete process.env.OPENUNUM_SECRETS_PASSPHRASE;
    else process.env.OPENUNUM_SECRETS_PASSPHRASE = originalPassphrase;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('stores plaintext secrets by default', () => {
    const next = saveSecretStore({
      secrets: {
        openrouterApiKey: 'sk-test-plaintext'
      }
    });
    expect(next.secrets.openrouterApiKey).toBe('sk-test-plaintext');

    const plainPath = path.join(tempHome, 'secrets.json');
    expect(fs.existsSync(plainPath)).toBe(true);
    const raw = fs.readFileSync(plainPath, 'utf8');
    expect(raw).toContain('sk-test-plaintext');
    expect(raw).not.toContain('"ciphertext"');

    const loaded = loadSecretStore();
    expect(loaded.secrets.openrouterApiKey).toBe('sk-test-plaintext');
    expect(getSecretStoreStatus().backend).toBe('plaintext');
  });

  it('stores encrypted secrets when passphrase backend is enabled', () => {
    process.env.OPENUNUM_SECRETS_BACKEND = 'passphrase';
    process.env.OPENUNUM_SECRETS_PASSPHRASE = 'test-passphrase-123';

    saveSecretStore({
      secrets: {
        openrouterApiKey: 'sk-test-encrypted'
      }
    });

    const encryptedPath = path.join(tempHome, 'secrets.enc.json');
    const plainPath = path.join(tempHome, 'secrets.json');
    expect(fs.existsSync(encryptedPath)).toBe(true);
    expect(fs.existsSync(plainPath)).toBe(false);

    const raw = fs.readFileSync(encryptedPath, 'utf8');
    expect(raw).toContain('"ciphertext"');
    expect(raw).toContain('"backend": "passphrase"');
    expect(raw).not.toContain('sk-test-encrypted');

    const loaded = loadSecretStore();
    expect(loaded.secrets.openrouterApiKey).toBe('sk-test-encrypted');
    const status = getSecretStoreStatus();
    expect(status.backend).toBe('passphrase');
    expect(status.locked).toBe(false);
  });

  it('returns locked store status when encrypted backend has no passphrase', () => {
    process.env.OPENUNUM_SECRETS_BACKEND = 'passphrase';
    process.env.OPENUNUM_SECRETS_PASSPHRASE = 'test-passphrase-123';
    saveSecretStore({
      secrets: {
        openrouterApiKey: 'sk-test-lock'
      }
    });

    delete process.env.OPENUNUM_SECRETS_PASSPHRASE;
    const loaded = loadSecretStore();
    expect(loaded.secrets.openrouterApiKey).toBe('');
    expect(loaded.__storeMeta?.locked).toBe(true);
    expect(getSecretStoreStatus().locked).toBe(true);
  });
});
