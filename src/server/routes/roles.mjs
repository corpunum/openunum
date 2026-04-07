import { RoleModelResolver, roleModelRegistry } from '../../core/role-model-registry.mjs';

// In-memory store for role overrides
const roleOverrides = new Map();
let resolver = new RoleModelResolver(roleModelRegistry);

function getRegistryWithOverrides() {
  const merged = { ...roleModelRegistry };
  for (const [role, overrides] of roleOverrides.entries()) {
    merged[role] = { ...merged[role], ...overrides };
  }
  return merged;
}

function getResolver() {
  return new RoleModelResolver(getRegistryWithOverrides());
}

export async function handleRolesRoute({ req, res, url, ctx }) {
  // GET /api/roles — list all roles and their model mappings
  if (req.method === 'GET' && url.pathname === '/api/roles') {
    const r = getResolver();
    const roles = {};
    for (const role of r.listRoles()) {
      roles[role] = r.resolve(role);
    }
    ctx.sendJson(res, 200, { ok: true, roles });
    return true;
  }

  // GET /api/roles/:role — get specific role config
  if (req.method === 'GET' && url.pathname.startsWith('/api/roles/')) {
    const role = url.pathname.replace('/api/roles/', '');
    const r = getResolver();
    if (!r.hasRole(role)) {
      ctx.sendJson(res, 404, { ok: false, error: `Role '${role}' not found` });
      return true;
    }
    ctx.sendJson(res, 200, {
      ok: true,
      role,
      config: r.resolve(role),
      hasOverride: roleOverrides.has(role)
    });
    return true;
  }

  // POST /api/roles/:role/override — override model for a role
  if (req.method === 'POST' && url.pathname.includes('/override')) {
    const match = url.pathname.match(/\/api\/roles\/([^/]+)\/override/);
    if (!match) {
      ctx.sendJson(res, 400, { ok: false, error: 'Invalid path format' });
      return true;
    }
    const role = match[1];
    const body = await ctx.parseBody(req);

    if (!body || typeof body !== 'object') {
      ctx.sendJson(res, 400, { ok: false, error: 'Request body required' });
      return true;
    }

    const override = {};
    if (body.recommended && Array.isArray(body.recommended)) {
      override.recommended = body.recommended.map(String);
    }
    if (body.blocked && Array.isArray(body.blocked)) {
      override.blocked = body.blocked.map(String);
    }
    if (body.minTier && typeof body.minTier === 'string') {
      override.minTier = body.minTier;
    }

    if (Object.keys(override).length === 0) {
      ctx.sendJson(res, 400, { ok: false, error: 'No valid override fields provided (recommended, blocked, minTier)' });
      return true;
    }

    roleOverrides.set(role, override);
    const r = getResolver();

    ctx.sendJson(res, 200, {
      ok: true,
      role,
      config: r.resolve(role),
      message: `Override applied for role '${role}'`
    });
    return true;
  }

  return false;
}
