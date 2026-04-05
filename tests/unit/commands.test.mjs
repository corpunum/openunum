import { describe, it, expect, beforeEach } from 'vitest';
import { parseCommand, parseCommandWithFlags, validateCommand } from '../../src/core/command-parser.mjs';
import { CommandRegistry, getRegistry } from '../../src/commands/registry.mjs';
import { loadBuiltinCommands } from '../../src/commands/loader.mjs';

describe('Command Parser', () => {
  it('should parse a simple command', () => {
    const result = parseCommand('/help');
    expect(result).not.toBeNull();
    expect(result.name).toBe('help');
    expect(result.args).toEqual([]);
    expect(result.isCommand).toBe(true);
  });

  it('should parse command with arguments', () => {
    const result = parseCommand('/rule add Always verify files');
    expect(result.name).toBe('rule');
    expect(result.args).toEqual(['add', 'Always', 'verify', 'files']);
  });

  it('should return null for non-command', () => {
    expect(parseCommand('hello world')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand(null)).toBeNull();
  });

  it('should parse flags correctly', () => {
    const result = parseCommandWithFlags('/compact --dry-run');
    expect(result.name).toBe('compact');
    expect(result.flags).toEqual({ 'dry-run': true });
    expect(result.args).toEqual([]);
  });

  it('should parse key=value flags', () => {
    const result = parseCommandWithFlags('/model switch --provider=ollama --model=qwen');
    expect(result.flags).toEqual({ provider: 'ollama', model: 'qwen' });
  });

  it('should validate command names', () => {
    expect(validateCommand({ name: 'help' })).toEqual({ valid: true, errors: [] });
    const emptyResult = validateCommand({ name: '' });
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors).toContain('Command name is required');
    const upperResult = validateCommand({ name: 'INVALID' });
    expect(upperResult.valid).toBe(false);
    expect(upperResult.errors[0]).toContain('Invalid command name');
  });
});

describe('Command Registry', () => {
  let registry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it('should register a command', () => {
    registry.register({
      name: 'test',
      description: 'Test command',
      execute: async () => 'test result',
      source: 'test'
    });
    expect(registry.get('test')).not.toBeNull();
    expect(registry.list()).toContainEqual(expect.objectContaining({ name: 'test' }));
  });

  it('should route to correct handler', async () => {
    registry.register({
      name: 'ping',
      execute: async () => 'pong',
      source: 'test'
    });
    const result = await registry.route('/ping', {});
    expect(result.handled).toBe(true);
    expect(result.reply).toBe('pong');
  });

  it('should handle unknown commands gracefully', async () => {
    const result = await registry.route('/unknown', {});
    expect(result.handled).toBe(false);
    expect(result.error).toContain('Unknown command');
  });

  it('should pass context to handler', async () => {
    let capturedCtx;
    registry.register({
      name: 'ctxtest',
      execute: async (args, flags, ctx) => {
        capturedCtx = ctx;
        return 'ok';
      },
      source: 'test'
    });
    await registry.route('/ctxtest', { sessionId: 'test-123', config: { foo: 'bar' } });
    expect(capturedCtx.sessionId).toBe('test-123');
    expect(capturedCtx.config.foo).toBe('bar');
  });

  it('should handle command execution errors', async () => {
    registry.register({
      name: 'fail',
      execute: async () => { throw new Error('boom'); },
      source: 'test'
    });
    const result = await registry.route('/fail', {});
    expect(result.handled).toBe(true);
    expect(result.error).toContain('boom');
  });

  it('should detect commands', () => {
    expect(registry.isCommand('/help')).toBe(true);
    expect(registry.isCommand('hello')).toBe(false);
  });
});

describe('Builtin Commands', () => {
  let registry;

  beforeEach(() => {
    registry = new CommandRegistry();
    // Manually register builtins for testing
    loadBuiltinCommands();
    registry = getRegistry();
  });

  it('should have all expected builtin commands', () => {
    const cmds = registry.list();
    const names = cmds.map(c => c.name);
    expect(names).toContain('help');
    expect(names).toContain('status');
    expect(names).toContain('new');
    expect(names).toContain('compact');
    expect(names).toContain('memory');
    expect(names).toContain('ledger');
    expect(names).toContain('cost');
    expect(names).toContain('session');
    expect(names).toContain('rule');
    expect(names).toContain('knowledge');
    expect(names).toContain('skill');
  });

  it('help should list all commands', async () => {
    const result = await registry.route('/help', {});
    expect(result.handled).toBe(true);
    expect(result.reply).toContain('Available slash commands');
    expect(result.reply).toContain('/help');
    expect(result.reply).toContain('/status');
  });

  it('help should show details for a specific command', async () => {
    const result = await registry.route('/help rule', {});
    expect(result.handled).toBe(true);
    expect(result.reply).toContain('/rule');
    expect(result.reply).toContain('Manage persistent behavioral rules');
  });

  it('help should handle unknown command gracefully', async () => {
    const result = await registry.route('/help nonexistent', {});
    expect(result.handled).toBe(true);
    expect(result.reply).toContain('Unknown command');
  });
});

describe('Rule Command', () => {
  let registry;

  beforeEach(() => {
    registry = getRegistry();
  });

  it('rule list should work', async () => {
    const result = await registry.route('/rule list', {});
    expect(result.handled).toBe(true);
    // Should either list rules or say "No rules stored"
    expect(result.reply).toBeDefined();
  });
});

describe('Knowledge Command', () => {
  let registry;

  beforeEach(() => {
    registry = getRegistry();
  });

  it('knowledge list should work', async () => {
    const result = await registry.route('/knowledge list', {});
    expect(result.handled).toBe(true);
    expect(result.reply).toBeDefined();
  });

  it('knowledge search without query should show usage', async () => {
    const result = await registry.route('/knowledge search', {});
    expect(result.handled).toBe(true);
    expect(result.reply).toContain('Usage');
  });
});
