function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function inferTypeMap(parameters = {}) {
  const props = parameters && typeof parameters === 'object' ? parameters.properties || {} : {};
  const out = {};
  for (const [key, spec] of Object.entries(props)) {
    if (!spec || typeof spec !== 'object') continue;
    if (typeof spec.type === 'string') out[key] = spec.type;
  }
  return out;
}

function asSchema(def) {
  return {
    type: 'function',
    function: deepClone(def)
  };
}

export const CORE_TOOL_DEFINITIONS = [
  {
    name: 'file_read',
    description: 'Read a UTF-8 file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'file_write',
    description: 'Write a UTF-8 file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'file_patch',
    description: 'Patch a file by replacing one string with another',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } },
      required: ['path', 'find', 'replace']
    }
  },
  {
    name: 'file_restore_last',
    description: 'Restore the last backed-up file mutation (optionally for a specific path)',
    parameters: { type: 'object', properties: { path: { type: 'string' } } }
  },
  {
    name: 'session_list',
    description: 'List stored chat sessions',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } }
  },
  {
    name: 'session_delete',
    description: 'Delete one chat session and its scoped history',
    parameters: {
      type: 'object',
      properties: { sessionId: { type: 'string' }, force: { type: 'boolean' }, operationId: { type: 'string' } },
      required: ['sessionId']
    }
  },
  {
    name: 'session_clear',
    description: 'Delete all chat sessions except an optional keepSessionId',
    parameters: {
      type: 'object',
      properties: { keepSessionId: { type: 'string' }, force: { type: 'boolean' }, operationId: { type: 'string' } }
    }
  },
  {
    name: 'shell_run',
    description: 'Run a shell command',
    parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] }
  },
  {
    name: 'browser_status',
    description: 'Get browser CDP status',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'browser_navigate',
    description: 'Navigate browser to URL',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
  },
  {
    name: 'browser_search',
    description: 'Search the web from browser',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'browser_type',
    description: 'Type text in element selector',
    parameters: {
      type: 'object',
      properties: { selector: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } },
      required: ['selector', 'text']
    }
  },
  {
    name: 'browser_click',
    description: 'Click element selector',
    parameters: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] }
  },
  {
    name: 'browser_extract',
    description: 'Extract visible text from selector',
    parameters: { type: 'object', properties: { selector: { type: 'string' } }, required: [] }
  },
  {
    name: 'browser_snapshot',
    description: 'List tabs and active tab metadata',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'http_request',
    description: 'Make a bounded HTTP request and return status plus parsed response when possible',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        method: { type: 'string' },
        headers: { type: 'object' },
        bodyJson: { type: 'object' },
        bodyText: { type: 'string' },
        timeoutMs: { type: 'number' }
      },
      required: ['url']
    }
  },
  {
    name: 'http_download',
    description: 'Download a URL to a local path via curl',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' }, outPath: { type: 'string' } },
      required: ['url', 'outPath']
    }
  },
  {
    name: 'desktop_open',
    description: 'Open app/file/url via xdg-open',
    parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] }
  },
  {
    name: 'desktop_xdotool',
    description: 'Run xdotool command for desktop control',
    parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] }
  },
  {
    name: 'skill_forge',
    description: 'Autonomously research and generate a high-quality Skill Bundle folder for a specific goal.',
    parameters: {
      type: 'object',
      properties: { goal: { type: 'string' }, research: { type: 'boolean' } },
      required: ['goal']
    }
  },
  {
    name: 'skill_load',
    description: 'Read a skill bundle documentation and inject its rules/knowledge into the current session context.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'skill_list',
    description: 'List installed local skills with review/approval status',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'skill_install',
    description: 'Install a skill from URL/path or inline code',
    parameters: { type: 'object', properties: { source: { type: 'string' }, name: { type: 'string' }, content: { type: 'string' } } }
  },
  {
    name: 'skill_review',
    description: 'Run security review for an installed skill',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'skill_approve',
    description: 'Approve an installed reviewed skill for execution',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'skill_execute',
    description: 'Execute an approved local skill',
    parameters: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'object' } }, required: ['name'] }
  },
  {
    name: 'skill_uninstall',
    description: 'Uninstall a local skill',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'email_status',
    description: 'Check googleworkspace CLI availability and auth status',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'email_send',
    description: 'Send Gmail message via googleworkspace CLI',
    parameters: {
      type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, cc: { type: 'string' }, bcc: { type: 'string' } },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'email_list',
    description: 'List recent Gmail messages via googleworkspace CLI',
    parameters: { type: 'object', properties: { limit: { type: 'number' }, query: { type: 'string' } } }
  },
  {
    name: 'email_read',
    description: 'Read a Gmail message by id via googleworkspace CLI',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'gworkspace_call',
    description: 'Call generic Google Workspace API via googleworkspace CLI (gws)',
    parameters: {
      type: 'object',
      properties: { service: { type: 'string' }, resource: { type: 'string' }, method: { type: 'string' }, params: { type: 'object' }, body: { type: 'object' } },
      required: ['service', 'resource', 'method']
    }
  },
  {
    name: 'research_run_daily',
    description: 'Run daily research pipeline (findings require review before adoption)',
    parameters: { type: 'object', properties: { simulate: { type: 'boolean' } } }
  },
  {
    name: 'research_list_recent',
    description: 'List recent research reports',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } }
  },
  {
    name: 'research_review_queue',
    description: 'List pending research proposals requiring review',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } }
  },
  {
    name: 'research_approve',
    description: 'Approve a researched proposal URL for controlled adoption',
    parameters: { type: 'object', properties: { url: { type: 'string' }, note: { type: 'string' } }, required: ['url'] }
  },
  {
    name: 'image_generate',
    description: 'Generate an image from a text prompt using the local FLUX.1-schnell model. Returns a base64-encoded PNG image.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image generation prompt describing the desired image' },
        width: { type: 'integer', description: 'Image width in pixels (default: 768, max: 960)' },
        height: { type: 'integer', description: 'Image height in pixels (default: 768, max: 960)' },
        steps: { type: 'integer', description: 'Number of diffusion steps (default: 4, range: 1-8)' }
      },
      required: ['prompt']
    }
  }
];

export function buildCoreToolSchemas() {
  return CORE_TOOL_DEFINITIONS.map((item) => asSchema(item));
}

export function buildValidationIndex(extraSchemas = []) {
  const all = [...buildCoreToolSchemas(), ...(Array.isArray(extraSchemas) ? extraSchemas : [])];
  const index = {};
  for (const schema of all) {
    const fn = schema && schema.function ? schema.function : null;
    const name = String(fn?.name || '').trim();
    if (!name) continue;
    const params = fn?.parameters || {};
    index[name] = {
      required: Array.isArray(params.required) ? [...params.required] : [],
      types: inferTypeMap(params)
    };
  }
  return index;
}

