/**
 * Freshness Decay Mechanisms (R5)
 * 
 * Exponential decay for memory relevance based on age.
 * freshness = 2^(-age / halfLife)
 * 
 * Half-lives by category:
 * - fact: 168h (7 days)
 * - strategy: 72h (3 days)
 * - skill: 24h (1 day)
 * - decision: 96h (4 days)
 * - preference: 120h (5 days)
 * - reflection: 336h (14 days)
 * - default: 48h (2 days)
 */

const HALF_LIVES_MS = {
  fact: 168 * 60 * 60 * 1000,      // 7 days
  strategy: 72 * 60 * 60 * 1000,   // 3 days
  skill: 24 * 60 * 60 * 1000,      // 1 day
  decision: 96 * 60 * 60 * 1000,   // 4 days
  preference: 120 * 60 * 60 * 1000, // 5 days
  reflection: 336 * 60 * 60 * 1000, // 14 days
  consolidated: 96 * 60 * 60 * 1000, // 4 days (consolidated patterns)
  default: 48 * 60 * 60 * 1000     // 2 days
};

const STALE_THRESHOLD = 0.125; // 1/8 = 3 half-lives

/**
 * Calculate freshness score using exponential decay
 * @param {number} createdAtMs - Creation timestamp in milliseconds
 * @param {number} halfLifeMs - Half-life in milliseconds
 * @returns {number} Freshness score (0.0 to 1.0)
 */
export function calculateFreshness(createdAtMs, halfLifeMs) {
  const now = Date.now();
  const ageMs = now - createdAtMs;
  
  if (ageMs <= 0) return 1.0;
  if (halfLifeMs <= 0) return 0.0;
  
  // Exponential decay: freshness = 2^(-age / halfLife)
  const decay = ageMs / halfLifeMs;
  return Math.pow(2, -decay);
}

/**
 * Check if a memory is stale based on freshness threshold
 * @param {number} createdAtMs - Creation timestamp in milliseconds
 * @param {number} halfLifeMs - Half-life in milliseconds
 * @param {number} threshold - Freshness threshold (default: 0.125)
 * @returns {boolean} True if memory is stale
 */
export function isStale(createdAtMs, halfLifeMs, threshold = STALE_THRESHOLD) {
  const freshness = calculateFreshness(createdAtMs, halfLifeMs);
  return freshness < threshold;
}

/**
 * Get half-life for a given category
 * @param {string} category - Memory category
 * @returns {number} Half-life in milliseconds
 */
export function getHalfLifeForCategory(category) {
  const cat = String(category || 'default').toLowerCase();
  return HALF_LIVES_MS[cat] || HALF_LIVES_MS.default;
}

/**
 * Apply freshness decay to a base relevance score
 * @param {number} baseScore - Base relevance score
 * @param {number} createdAtMs - Creation timestamp in milliseconds
 * @param {string} category - Memory category
 * @returns {number} Freshness-weighted score
 */
export function applyFreshnessDecay(baseScore, createdAtMs, category) {
  const halfLifeMs = getHalfLifeForCategory(category);
  const freshness = calculateFreshness(createdAtMs, halfLifeMs);
  return baseScore * freshness;
}

/**
 * Extract freshness metadata from a record
 * @param {object} record - Memory record with createdAt/updated_at
 * @param {string} category - Memory category
 * @returns {{freshness: number, halfLifeMs: number, ageMs: number, isStale: boolean}}
 */
export function getFreshnessMetadata(record, category = 'default') {
  const createdAtMs = record.createdAt 
    ? new Date(record.createdAt).getTime()
    : record.created_at 
      ? new Date(record.created_at).getTime()
      : Date.now();
  
  const halfLifeMs = getHalfLifeForCategory(category || record.category || 'default');
  const freshness = calculateFreshness(createdAtMs, halfLifeMs);
  const ageMs = Date.now() - createdAtMs;
  const stale = isStale(createdAtMs, halfLifeMs);
  
  return {
    freshness,
    halfLifeMs,
    ageMs,
    isStale: stale,
    category: category || record.category || 'default'
  };
}

/**
 * Get all half-life configurations
 * @returns {object} Half-life map in hours
 */
export function getHalfLifeConfig() {
  const config = {};
  for (const [key, ms] of Object.entries(HALF_LIVES_MS)) {
    config[key] = Math.round(ms / (60 * 60 * 1000)); // Convert to hours
  }
  return config;
}

/**
 * Calculate time until a memory becomes stale
 * @param {number} createdAtMs - Creation timestamp in milliseconds
 * @param {number} halfLifeMs - Half-life in milliseconds
 * @param {number} threshold - Freshness threshold
 * @returns {number} Milliseconds until stale
 */
export function getTimeUntilStale(createdAtMs, halfLifeMs, threshold = STALE_THRESHOLD) {
  // freshness = 2^(-age / halfLife) = threshold
  // -age / halfLife = log2(threshold)
  // age = -halfLife * log2(threshold)
  const staleAge = -halfLifeMs * Math.log2(threshold);
  const currentAge = Date.now() - createdAtMs;
  return Math.max(0, staleAge - currentAge);
}
