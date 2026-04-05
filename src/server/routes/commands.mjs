import { getRegistry } from '../../commands/registry.mjs';
import { parseCommand } from '../../core/command-parser.mjs';
import { logInfo, logError } from '../../logger.mjs';

/**
 * API route handler for command execution
 * 
 * POST /api/command
 * Body: { message, sessionId }
 * Response: { handled, reply, commandName, error }
 */
export async function handleCommandRoute({ req, res, url, ctx }) {
  // Only accept POST
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
    return true;
  }

  // Parse request body
  const body = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });

  const { message, sessionId } = body;
  if (!message) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'message field is required' }));
    return true;
  }

  // Check if it's a command
  const parsed = parseCommand(message);
  if (!parsed) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ handled: false, message: 'Not a command (must start with /)' }));
    return true;
  }

  try {
    const registry = getRegistry();
    const result = await registry.route(message, {
      sessionId: sessionId || 'api',
      agent: ctx.agent,
      memoryStore: ctx.memoryStore,
      config: ctx.config
    });

    res.writeHead(result?.handled ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result || { handled: false }));
    return true;
  } catch (error) {
    logError('command_api_error', { error: String(error.message || error) });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error.message || error) }));
    return true;
  }
}

/**
 * API route to list all available commands
 * 
 * GET /api/commands
 * Response: { commands: [...] }
 */
export async function handleCommandsListRoute({ req, res, ctx }) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
    return true;
  }

  try {
    const registry = getRegistry();
    const commands = registry.list();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ commands }));
    return true;
  } catch (error) {
    logError('commands_list_error', { error: String(error.message || error) });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error.message || error) }));
    return true;
  }
}

export default { handleCommandRoute, handleCommandsListRoute };
