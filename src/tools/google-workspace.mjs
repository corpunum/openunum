import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function base64Url(input) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseJsonOrRaw(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function safeObj(obj) {
  return obj && typeof obj === 'object' ? obj : {};
}

function buildRawEmail({ to, subject, body, cc, bcc }) {
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8'
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}

export class GoogleWorkspaceClient {
  constructor(config) {
    this.config = config;
    this.gwsBin = String(config?.integrations?.googleWorkspace?.cliCommand || 'gws');
  }

  async run(args) {
    try {
      const { stdout, stderr } = await execFileAsync(this.gwsBin, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
      return {
        ok: true,
        stdout: parseJsonOrRaw(stdout),
        stderr: String(stderr || '').trim()
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error.message || error),
        code: error.code || null,
        stdout: parseJsonOrRaw(error.stdout || ''),
        stderr: String(error.stderr || '').trim()
      };
    }
  }

  async status() {
    const v = await this.run(['--version']);
    if (!v.ok) {
      return {
        ok: true,
        installed: false,
        cli: this.gwsBin,
        hint: 'Install with npm install -g @googleworkspace/cli then run gws auth setup.'
      };
    }
    const auth = await this.run(['auth', 'status']);
    return {
      ok: true,
      installed: true,
      cli: this.gwsBin,
      version: typeof v.stdout?.raw === 'string' ? v.stdout.raw : JSON.stringify(v.stdout),
      authenticated: auth.ok,
      auth: auth.ok ? auth.stdout : { error: auth.error }
    };
  }

  async call({ service, resource, method, params = {}, body = null }) {
    const s = String(service || '').trim();
    const r = String(resource || '').trim();
    const m = String(method || '').trim();
    if (!s || !r || !m) {
      return { ok: false, error: 'service_resource_method_required' };
    }
    const methodParts = m.split(/\s+/).filter(Boolean);
    const args = [s, r, ...methodParts, '--params', JSON.stringify(safeObj(params))];
    if (body && typeof body === 'object') {
      args.push('--json', JSON.stringify(body));
    }
    return this.run(args);
  }

  async gmailSend({ to, subject, body, cc = '', bcc = '' }) {
    if (!to || !subject || !body) return { ok: false, error: 'to_subject_body_required' };
    const raw = buildRawEmail({ to, subject, body, cc, bcc });
    return this.call({
      service: 'gmail',
      resource: 'users',
      method: 'messages send',
      params: { userId: 'me' },
      body: { raw: base64Url(raw) }
    });
  }

  async gmailList({ limit = 10, query = '' }) {
    return this.call({
      service: 'gmail',
      resource: 'users',
      method: 'messages list',
      params: { userId: 'me', maxResults: Number(limit) || 10, q: String(query || '') }
    });
  }

  async gmailRead({ id, format = 'full' }) {
    if (!id) return { ok: false, error: 'id_required' };
    return this.call({
      service: 'gmail',
      resource: 'users',
      method: 'messages get',
      params: { userId: 'me', id: String(id), format: String(format || 'full') }
    });
  }
}
