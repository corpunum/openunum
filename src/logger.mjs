export function logInfo(message, meta = {}) {
  console.log(JSON.stringify({ level: 'info', ts: new Date().toISOString(), message, ...meta }));
}

export function logError(message, meta = {}) {
  console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), message, ...meta }));
}
