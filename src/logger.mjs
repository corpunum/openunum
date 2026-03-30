import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir } from './config.mjs';

const LOG_FILE = path.join(getHomeDir(), 'logs', 'openunum.log');
const ERROR_LOG = path.join(getHomeDir(), 'logs', 'errors.log');

// Ensure logs directory exists
try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
} catch {
  // ignore
}

function writeLog(file, entry) {
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    // ignore disk errors
  }
}

export function logInfo(message, meta = {}) {
  const entry = {
    level: 'info',
    ts: new Date().toISOString(),
    message,
    ...meta
  };
  console.log(JSON.stringify(entry));
  writeLog(LOG_FILE, entry);
}

export function logError(message, meta = {}) {
  const entry = {
    level: 'error',
    ts: new Date().toISOString(),
    message,
    ...meta
  };
  console.error(JSON.stringify(entry));
  writeLog(LOG_FILE, entry);
  writeLog(ERROR_LOG, entry);
}

export function logWarn(message, meta = {}) {
  const entry = {
    level: 'warn',
    ts: new Date().toISOString(),
    message,
    ...meta
  };
  console.warn(JSON.stringify(entry));
  writeLog(LOG_FILE, entry);
}

export function logDebug(message, meta = {}) {
  if (process.env.OPENUNUM_DEBUG === '1') {
    const entry = {
      level: 'debug',
      ts: new Date().toISOString(),
      message,
      ...meta
    };
    console.debug(JSON.stringify(entry));
    writeLog(LOG_FILE, entry);
  }
}

export function logHealth(component, status, details = {}) {
  const entry = {
    level: 'health',
    ts: new Date().toISOString(),
    component,
    status,
    ...details
  };
  writeLog(LOG_FILE, entry);
}

export function logSelfHeal(action, result) {
  const entry = {
    level: 'self-heal',
    ts: new Date().toISOString(),
    action,
    result
  };
  console.log(JSON.stringify(entry));
  writeLog(LOG_FILE, entry);
}

export function getRecentLogs(lines = 100) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    return content.split('\n').filter(Boolean).slice(-lines).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  } catch {
    return [];
  }
}

export function getRecentErrors(lines = 50) {
  try {
    if (!fs.existsSync(ERROR_LOG)) return [];
    const content = fs.readFileSync(ERROR_LOG, 'utf8');
    return content.split('\n').filter(Boolean).slice(-lines).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  } catch {
    return [];
  }
}
