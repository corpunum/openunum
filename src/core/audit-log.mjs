/**
 * Tamper-Evident Audit Logging
 * 
 * HMAC-SHA256 chain hashing with append-only JSONL storage.
 * Supports Merkle root computation every N entries.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// Canonical audit storage path lives under OPENUNUM_HOME unless explicitly overridden.
const HOME_DIR = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
const DATA_DIR = process.env.OPENUNUM_DATA_DIR || path.join(HOME_DIR, 'audit');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'audit-log.jsonl');
const MERKLE_ROOT_INTERVAL = 10; // Compute merkle root every 10 entries

// HMAC Secret Management:
// 1. AUDIT_HMAC_SECRET env var (highest priority)
// 2. Auto-generated secret stored in ~/.openunum/audit-hmac-secret
// 3. Fallback (only for tests/dev, logged as warning)
const FALLBACK_HMAC_SECRET = 'openunum-audit-secret-change-in-production';

function resolveHmacSecret() {
  // Priority 1: environment variable
  if (process.env.AUDIT_HMAC_SECRET) {
    return process.env.AUDIT_HMAC_SECRET;
  }

  // Priority 2: persisted secret file
  const homeDir = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
  const secretPath = path.join(homeDir, 'audit-hmac-secret');
  try {
    if (fs.existsSync(secretPath)) {
      const stored = fs.readFileSync(secretPath, 'utf8').trim();
      if (stored.length >= 32) {
        return stored;
      }
    }
  } catch { /* ignore read errors, regenerate */ }

  // Generate a new random secret and persist it
  try {
    fs.mkdirSync(homeDir, { recursive: true });
    const newSecret = crypto.randomBytes(64).toString('hex');
    fs.writeFileSync(secretPath, newSecret, { mode: 0o600 }); // owner-only permissions
    console.warn(`[audit-log] Generated new HMAC secret at ${secretPath}. Keep this file secure.`);
    return newSecret;
  } catch (writeErr) {
    console.error(`[audit-log] WARNING: Could not persist HMAC secret to ${secretPath}: ${writeErr.message}. Using insecure fallback.`);
    return FALLBACK_HMAC_SECRET;
  }
}

const HMAC_SECRET = resolveHmacSecret();
const USING_FALLBACK_SECRET = HMAC_SECRET === FALLBACK_HMAC_SECRET;
if (USING_FALLBACK_SECRET) {
  console.error('[audit-log] CRITICAL: Using hardcoded HMAC secret. Audit chain is NOT tamper-evident in production. Set AUDIT_HMAC_SECRET env var or ensure ~/.openunum/ is writable.');
}
const EVENT_TYPES = ['tool_call', 'state_change', 'config_mutation', 'verification'];

// Ensure data directory exists
function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Generate UUID v4
function generateUUID() {
  return crypto.randomUUID();
}

// Compute HMAC-SHA256 hash
function computeHmac(data) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('hex');
}

// Compute SHA256 hash
function computeHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function buildStandardHashPayload(entry) {
  return {
    entryId: entry.entryId,
    timestamp: entry.timestamp,
    eventType: entry.eventType,
    correlationId: entry.correlationId,
    previousHash: entry.previousHash,
    payload: entry.payload
  };
}

function buildLegacyMerkleHashPayload(entry) {
  if (entry?.eventType !== 'verification' || entry?.payload?.type !== 'merkle_root_computed') {
    return null;
  }
  return {
    merkleRoot: entry.payload?.merkleRoot,
    count: entry.payload?.entryCount
  };
}

function computeEntryCurrentHash(entry) {
  return computeHmac(JSON.stringify(buildStandardHashPayload(entry)));
}

// Hash an entry for chain linking
function hashEntry(entry) {
  const data = JSON.stringify({
    entryId: entry.entryId,
    timestamp: entry.timestamp,
    eventType: entry.eventType,
    correlationId: entry.correlationId,
    payload: entry.payload
  });
  return computeHash(data);
}

// Get all entries from the log file
function getAllEntries() {
  ensureDataDir();
  if (!fs.existsSync(AUDIT_LOG_PATH)) {
    return [];
  }
  const content = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
  if (!content.trim()) return [];
  return content.trim().split('\n').map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// Get the last entry's hash (for chain linking)
function getLastHash() {
  const entries = getAllEntries();
  if (entries.length === 0) return '0'.repeat(64); // Genesis hash
  return entries[entries.length - 1].currentHash;
}

// Compute Merkle root from array of hashes
function computeMerkleRoot(hashes) {
  if (hashes.length === 0) return computeHash('empty');
  if (hashes.length === 1) return hashes[0];
  
  const newLevel = [];
  for (let i = 0; i < hashes.length; i += 2) {
    const left = hashes[i];
    const right = hashes[i + 1] || left;
    newLevel.push(computeHash(left + right));
  }
  return computeMerkleRoot(newLevel);
}

// Append entry to log file
function appendEntry(entry) {
  ensureDataDir();
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(AUDIT_LOG_PATH, line, 'utf8');
}

/**
 * Log an audit event
 * @param {string} type - Event type (tool_call, state_change, config_mutation, verification)
 * @param {object} payload - Event payload
 * @param {string} [correlationId] - Optional correlation ID for grouping related events
 * @returns {object} The created entry
 */
export function logEvent(type, payload, correlationId) {
  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`Invalid event type: ${type}. Must be one of: ${EVENT_TYPES.join(', ')}`);
  }
  
  const timestamp = new Date().toISOString();
  const entryId = generateUUID();
  const previousHash = getLastHash();
  
  const entry = {
    entryId,
    timestamp,
    eventType: type,
    correlationId: correlationId || generateUUID(),
    previousHash,
    currentHash: null, // Will be set after computing
    payload
  };
  
  // Compute current hash including previousHash for chain integrity
  entry.currentHash = computeHmac(JSON.stringify({
    ...buildStandardHashPayload(entry)
  }));
  
  appendEntry(entry);
  
  // Check if we should compute a Merkle root
  const entries = getAllEntries();
  if (entries.length % MERKLE_ROOT_INTERVAL === 0) {
    const hashes = entries.map(e => e.currentHash);
    const merkleRoot = computeMerkleRoot(hashes);
    // Log the merkle root as a special entry
    const merkleEntry = {
      entryId: generateUUID(),
      timestamp: new Date().toISOString(),
      eventType: 'verification',
      correlationId: entry.correlationId,
      previousHash: entry.currentHash,
      currentHash: null,
      payload: { merkleRoot, entryCount: entries.length, type: 'merkle_root_computed' }
    };
    merkleEntry.currentHash = computeEntryCurrentHash(merkleEntry);
    appendEntry(merkleEntry);
  }
  
  return entry;
}

/**
 * Verify the integrity of the audit chain
 * @returns {object} { valid: boolean, brokenAt: number|null, entries: object[] }
 */
export function verifyChain() {
  const entries = getAllEntries();
  
  if (entries.length === 0) {
    return {
      valid: true,
      strictValid: true,
      brokenAt: null,
      entries: [],
      diagnostics: { legacyMerkleEntries: 0, hashModeCounts: { standard: 0, legacy_merkle: 0 } }
    };
  }
  
  let previousHash = '0'.repeat(64);
  let legacyMerkleEntries = 0;
  const hashModeCounts = { standard: 0, legacy_merkle: 0 };
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    
    // Verify previousHash linkage
    if (entry.previousHash !== previousHash) {
      return { valid: false, brokenAt: i, entries };
    }
    
    // Recompute and verify current hash
    const expectedHash = computeEntryCurrentHash(entry);
    if (entry.currentHash === expectedHash) {
      hashModeCounts.standard += 1;
    } else {
      const legacyMerklePayload = buildLegacyMerkleHashPayload(entry);
      const legacyHash = legacyMerklePayload
        ? computeHmac(JSON.stringify(legacyMerklePayload))
        : null;
      if (legacyHash && entry.currentHash === legacyHash) {
        legacyMerkleEntries += 1;
        hashModeCounts.legacy_merkle += 1;
      } else {
        return {
          valid: false,
          strictValid: false,
          brokenAt: i,
          entries,
          diagnostics: {
            legacyMerkleEntries,
            hashModeCounts,
            reason: 'hash_mismatch'
          }
        };
      }
    }
    
    previousHash = entry.currentHash;
  }
  
  return {
    valid: true,
    strictValid: legacyMerkleEntries === 0,
    brokenAt: null,
    entries,
    diagnostics: {
      legacyMerkleEntries,
      hashModeCounts
    }
  };
}

/**
 * Get log entries with optional filtering
 * @param {object} options - { since: ISO timestamp, type: event type, limit: number }
 * @returns {object[]} Array of entries
 */
export function getLog(options = {}) {
  const { since, type, limit } = options;
  let entries = getAllEntries();
  
  // Filter by timestamp
  if (since) {
    const sinceDate = new Date(since);
    entries = entries.filter(e => new Date(e.timestamp) >= sinceDate);
  }
  
  // Filter by event type
  if (type) {
    entries = entries.filter(e => e.eventType === type);
  }
  
  // Apply limit (from end, most recent first for time-based queries)
  if (limit && limit > 0) {
    entries = entries.slice(-limit);
  }
  
  return entries;
}

/**
 * Get the current Merkle root from the most recent merkle root entry
 * @returns {string|null} Merkle root hash or null if not computed yet
 */
export function getMerkleRoot() {
  const entries = getAllEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.eventType === 'verification' && 
        entry.payload?.type === 'merkle_root_computed') {
      return entry.payload.merkleRoot;
    }
  }
  
  // If no stored merkle root, compute from current entries
  if (entries.length > 0) {
    const hashes = entries.map(e => e.currentHash);
    return computeMerkleRoot(hashes);
  }
  
  return null;
}

/**
 * Clear all audit logs (use with caution!)
 * @returns {boolean} Success status
 */
export function clearAuditLog() {
  if (fs.existsSync(AUDIT_LOG_PATH)) {
    fs.unlinkSync(AUDIT_LOG_PATH);
  }
  return true;
}

/**
 * Get audit log statistics
 * @returns {object} Statistics object
 */
export function getAuditStats() {
  const entries = getAllEntries();
  const byType = {};
  
  for (const entry of entries) {
    byType[entry.eventType] = (byType[entry.eventType] || 0) + 1;
  }
  
  return {
    totalEntries: entries.length,
    byType,
    firstEntry: entries.length > 0 ? entries[0].timestamp : null,
    lastEntry: entries.length > 0 ? entries[entries.length - 1].timestamp : null,
    merkleRoot: getMerkleRoot()
  };
}

export function getAuditDiagnostics() {
  const verification = verifyChain();
  const stats = getAuditStats();
  const issues = [];
  const recommendations = [];

  if (!verification.valid) {
    issues.push({
      code: 'audit_chain_invalid',
      severity: 'critical',
      message: `Audit chain verification failed at entry index ${verification.brokenAt}.`
    });
    recommendations.push('Stop trusting audit-derived automation until the broken entry is investigated.');
    recommendations.push('Read the audit log around the broken index and correlate it with recent tests or manual edits.');
  } else if (verification.diagnostics?.legacyMerkleEntries > 0) {
    issues.push({
      code: 'legacy_merkle_checkpoint_hash',
      severity: 'warning',
      message: `${verification.diagnostics.legacyMerkleEntries} legacy Merkle checkpoint entr${verification.diagnostics.legacyMerkleEntries === 1 ? 'y uses' : 'ies use'} the old hash schema.`
    });
    recommendations.push('Keep compatibility verification enabled for historical logs.');
    recommendations.push('Allow new checkpoint entries to use the canonical entry hash schema only.');
  }

  return {
    ok: verification.valid,
    dataDir: DATA_DIR,
    auditLogPath: AUDIT_LOG_PATH,
    verification,
    stats,
    issues,
    recommendations
  };
}

// Export event types for reference
export { EVENT_TYPES };

// Export for testing
export { AUDIT_LOG_PATH, DATA_DIR };
