import { describe, expect, it } from 'vitest';
import { RoleModelResolver, roleModelRegistry } from '../../src/core/role-model-registry.mjs';

describe('role-model-registry', () => {
  const resolver = new RoleModelResolver(roleModelRegistry);

  it('exposes isAllowed as an alias for role checks', () => {
    const out = resolver.isAllowed('code_gen', 'ollama-cloud/qwen3.5:397b-cloud');
    expect(out.allowed).toBe(true);
  });

  it('rejects models below the minimum tier for the role', () => {
    const out = resolver.isAllowed('code_gen', 'ollama-local/gemma4:cpu');
    expect(out.allowed).toBe(false);
    expect(out.reason.includes('below required tier')).toBe(true);
  });
});
