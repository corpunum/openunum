import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logInfo, logError } from '../logger.mjs';

/**
 * Get learning data file path
 * @private
 */
function getLearningDataPath() {
  const home = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
  return path.join(home, 'router-learning.json');
}

/**
 * Get telemetry file path
 * @private
 */
function getTelemetryPath() {
  const home = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
  return path.join(home, 'router-telemetry.jsonl');
}

/**
 * FastAwarenessRouter — Full Implementation (Phase 1 + Phase 2)
 * 
 * Classifies user messages to determine optimal retrieval strategy:
 * 1. skip-retrieval: Task-meta questions (answer from working memory directly)
 * 2. hot-only: Task continuation (skip BM25, use recent context only)
 * 3. indexed-only: Knowledge questions (include BM25 retrieval)
 * 4. full-search: External queries (need web search)
 * 5. deep-inspect: File operations (need filesystem search)
 * 
 * Phase 1 (MWS): Strategies 1-3
 * Phase 2: Strategies 4-5 + Learning layer
 */

const DEFAULT_CONFIG = {
  enabled: true,
  minConfidenceForSkip: 0.85,
  minConfidenceForHotOnly: 0.70,
  minFeatureGreetingScore: 0.86,
  minFeatureLowIntentScore: 0.76,
  weakModelTokenLimit: 4096,
  cacheHitWindowMs: 30000,
  learningEnabled: true,
  learningDataPath: null, // Will use getHomeDir()/router-learning.json
  telemetryEnabled: true,
    classificationRules: {
    greetingKeywords: [
      'hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'greetings', 'yo'
    ],
    taskMetaKeywords: [
      'current task', 'what am i doing', 'my task', 'step am i',
      'what is my', 'where are we', 'progress', 'status',
      'what was i', 'remind me', 'what did i', 'what have i'
    ],
    continuationKeywords: [
      'continue', 'go on', 'proceed', 'next', 'keep going',
      'and then', 'after that', 'do more', 'continue with'
    ],
    externalKeywords: [
      'search', 'latest', 'news', 'today', 'now', 'current',
      'recent', 'web', 'internet', 'online', 'look up',
      'what happened', 'current events', 'this week'
    ],
    deepInspectKeywords: [
      'find files', 'search files', 'look for file', 'grep',
      'locate', 'where is', 'find all', 'search all', 'glob',
      'search for', 'file search', 'in the codebase'
    ]
  },
  strategyTools: {
    'full-search': ['web_search', 'web_fetch', 'browser_search'],
    'deep-inspect': ['file_search', 'file_grep', 'file_info'],
    'skip-retrieval': [],
    'hot-only': [],
    'indexed-only': []
  }
};

const TASK_SIGNAL_RE = /\b(what|how|why|where|when|which|who|can you|please|show|list|check|fix|create|build|run|install|open|search|find|write|read|explain|configure|debug|error|trace|stack|app|runtime|model|provider|continue|proceed|next|keep going|go on|grep|file|files|web|latest|news|today|current|weather|wea+ther|wether|forecast|temperature|rain|wind|humidity)\b/;
const WEATHER_SIGNAL_RE = /\b(weather|wea+ther|wether|forecast|temperature|rain|wind|humidity)\b/;

/**
 * Classification result shape
 * @typedef {Object} ClassificationResult
 * @property {string} category - 'greeting' | 'light-chat' | 'task-meta' | 'continuation' | 'external' | 'deep-inspect' | 'knowledge' | 'unknown'
 * @property {number} confidence - 0.0 to 1.0
 * @property {boolean} shouldShortCircuit - Whether to skip tool execution
 * @property {string} strategy - 'skip-retrieval' | 'hot-only' | 'indexed-only' | 'full-search' | 'deep-inspect'
 * @property {string} [reason] - Human-readable reason for classification
 * @property {Object} [matchedKeywords] - Keywords that matched
 */

export class FastAwarenessRouter {
  constructor(config = {}, workingMemory = null) {
    const userRules = config?.classificationRules || {};
    const userStrategyTools = config?.strategyTools || {};
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      classificationRules: {
        ...DEFAULT_CONFIG.classificationRules,
        ...userRules
      },
      strategyTools: {
        ...DEFAULT_CONFIG.strategyTools,
        ...userStrategyTools
      }
    };
    this.workingMemory = workingMemory;
    this.cache = new Map();  // Simple LRU-like cache for classification results
    this.classificationCount = 0;
    this.stats = {
      total: 0,
      skipRetrieval: 0,
      hotOnly: 0,
      indexedOnly: 0,
      fullSearch: 0,
      deepInspect: 0
    };
    // Phase 2: Learning layer
    this.learningData = {
      successByCategory: {},     // { 'task-meta': 45, 'continuation': 23, ... }
      failureByCategory: {},     // { 'task-meta': 2, 'external': 5, ... }
      adjustmentFactors: {},     // Category-specific confidence adjustments
      recentOutcomes: []         // Last 100 outcomes for trend analysis
    };
    // Load persisted learning data
    this._loadLearningData();
  }

  /**
   * Classify a message to determine retrieval strategy
   * 
   * @param {string} message - User's message
   * @returns {ClassificationResult}
   */
  classify(message) {
    if (!this.config.enabled) {
      return this._unknownResult('router_disabled');
    }

    const normalized = this._normalize(message);
    const startTime = Date.now();
    
    // Check cache first
    const cacheKey = this._cacheKey(normalized);
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.config.cacheHitWindowMs) {
      logInfo('fast_awareness_cache_hit', { category: cached.result.category, latency: Date.now() - startTime });
      return cached.result;
    }

    // Step 1: Check if working memory has context about current task
    const hasWorkingMemory = this.workingMemory && this.workingMemory.hasAnchor();
    const isAboutCurrentTask = hasWorkingMemory && this.workingMemory.isAboutCurrentTask(message);

    // Step 2: Score by keyword matching
    const keywordScores = this._scoreKeywords(normalized);
    
    // Step 3: Apply learning adjustments (Phase 2)
    const adjustedScores = this._applyLearningAdjustments(keywordScores);
    
    // Step 4: Determine category and strategy
    const result = this._determineStrategy({
      normalized,
      isAboutCurrentTask,
      hasWorkingMemory,
      keywordScores: adjustedScores
    });

    // Update stats
    this.stats.total++;
    this.stats[result.strategy.replace(/-/g, '')] = (this.stats[result.strategy.replace(/-/g, '')] || 0) + 1;

    // Cache the result
    this.cache.set(cacheKey, { result, timestamp: Date.now() });
    this._evictOldCacheEntries();

    logInfo('fast_awareness_classified', {
      category: result.category,
      strategy: result.strategy,
      confidence: result.confidence,
      shouldShortCircuit: result.shouldShortCircuit,
      recommendedTools: result.recommendedTools,
      latency: Date.now() - startTime
    });

    return result;
  }

  /**
   * Normalize message for comparison
   * @private
   */
  _normalize(message) {
    return String(message || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Score keyword matches
   * @private
   */
  _scoreKeywords(normalized) {
    const rules = this.config.classificationRules;
    const greetingKeywords = Array.isArray(rules?.greetingKeywords) ? rules.greetingKeywords : [];
    const taskMetaKeywords = Array.isArray(rules?.taskMetaKeywords) ? rules.taskMetaKeywords : [];
    const continuationKeywords = Array.isArray(rules?.continuationKeywords) ? rules.continuationKeywords : [];
    const externalKeywords = Array.isArray(rules?.externalKeywords) ? rules.externalKeywords : [];
    const deepInspectKeywords = Array.isArray(rules?.deepInspectKeywords) ? rules.deepInspectKeywords : [];
    const scores = {
      greeting: 0,
      lightChat: 0,
      taskMeta: 0,
      continuation: 0,
      external: 0,
      deepInspect: 0
    };

    const featureScores = this._scoreLowIntentFeatures(normalized);

    const hasTaskSignal = TASK_SIGNAL_RE.test(normalized);
    if (featureScores.greeting >= this.config.minFeatureGreetingScore && !hasTaskSignal) {
      scores.greeting = 0.98;
    } else {
      if (!hasTaskSignal) {
        for (const kw of greetingKeywords) {
          if (normalized === kw || normalized.startsWith(`${kw} `)) {
            scores.greeting = Math.max(scores.greeting, 0.92);
          }
        }
      }
    }
    scores.lightChat = Math.max(scores.lightChat, featureScores.lowIntent);

    // Check each category - presence-based scoring with boost
    for (const kw of taskMetaKeywords) {
      if (normalized.includes(kw)) {
        // Base score for presence + boost for phrase length
        scores.taskMeta = Math.max(scores.taskMeta, 0.75 + 0.05 * kw.split(' ').length);
      }
    }

    for (const kw of continuationKeywords) {
      if (normalized.includes(kw)) {
        scores.continuation = Math.max(scores.continuation, 0.75 + 0.05 * kw.split(' ').length);
      }
    }

    for (const kw of externalKeywords) {
      if (normalized.includes(kw)) {
        scores.external = Math.max(scores.external, 0.75 + 0.05 * kw.split(' ').length);
      }
    }

    for (const kw of deepInspectKeywords) {
      if (normalized.includes(kw)) {
        scores.deepInspect = Math.max(scores.deepInspect, 0.75 + 0.05 * kw.split(' ').length);
      }
    }

    // Strong boost for exact phrase matches
    if (/\b(what is my|where are we|what am i|what's my|remind me)\b/.test(normalized)) {
      scores.taskMeta = Math.min(1.0, Math.max(scores.taskMeta, 0.9));
    }

    if (/\b(continue|go on|proceed|keep going)\b/.test(normalized)) {
      scores.continuation = Math.min(1.0, Math.max(scores.continuation, 0.9));
    }

    return scores;
  }

  _scoreLowIntentFeatures(normalized) {
    const text = String(normalized || '').trim();
    if (!text) return { greeting: 0, lowIntent: 0 };
    const words = text.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const charCount = text.length;
    const punctuationCount = (text.match(/[?!.,:;]/g) || []).length;
    const salutationHit = /^(hi|hello|hey|yo|greetings|good morning|good afternoon|good evening)\b/.test(text);
    const hasTaskSignal = TASK_SIGNAL_RE.test(text);
    const hasCodeLike = /[\\/`$={}[\]<>]/.test(text) || /\d{2,}/.test(text);

    let lowIntent = 0;
    if (wordCount <= 3) lowIntent += 0.45;
    else if (wordCount <= 5) lowIntent += 0.25;
    if (charCount <= 22) lowIntent += 0.3;
    else if (charCount <= 34) lowIntent += 0.15;
    if (punctuationCount <= 1) lowIntent += 0.05;
    if (!hasTaskSignal) lowIntent += 0.2;
    if (!hasCodeLike) lowIntent += 0.1;
    if (hasTaskSignal) lowIntent -= 0.8;
    if (hasCodeLike) lowIntent -= 0.7;
    if (wordCount > 6 || charCount > 60) lowIntent -= 0.4;
    lowIntent = Math.max(0, Math.min(1, lowIntent));

    let greeting = 0;
    if (hasTaskSignal || hasCodeLike) {
      return { greeting: 0, lowIntent };
    }
    if (salutationHit) greeting += 0.6;
    if (wordCount <= 3) greeting += 0.2;
    if (charCount <= 24) greeting += 0.15;
    if (!hasTaskSignal && !hasCodeLike) greeting += 0.1;
    greeting = Math.max(0, Math.min(1, greeting));

    return { greeting, lowIntent };
  }

  /**
   * Determine strategy based on analysis
   * @private
   */
  _determineStrategy({ normalized, isAboutCurrentTask, hasWorkingMemory, keywordScores }) {
    const { greeting, lightChat, taskMeta, continuation, external, deepInspect } = keywordScores;

    if (this._isSimpleGreeting(normalized)) {
      return {
        category: 'greeting',
        confidence: Math.max(greeting, 0.95),
        shouldShortCircuit: true,
        strategy: 'skip-retrieval',
        reason: 'simple_greeting_match',
        matchedKeywords: { greeting: Math.max(greeting, 0.95) },
        recommendedTools: this.config.strategyTools['skip-retrieval'] || []
      };
    }

    // Strategy 0: greeting small-talk fast path (direct response, no tools)
    if (greeting >= this.config.minConfidenceForSkip) {
      return {
        category: 'greeting',
        confidence: greeting,
        shouldShortCircuit: true,
        strategy: 'skip-retrieval',
        reason: `greeting_keywords: ${greeting.toFixed(2)}`,
        matchedKeywords: { greeting },
        recommendedTools: this.config.strategyTools['skip-retrieval'] || []
      };
    }

    // Strategy 0.5: generic low-intent short utterance fast path
    if (lightChat >= this.config.minConfidenceForSkip) {
      return {
        category: 'light-chat',
        confidence: lightChat,
        shouldShortCircuit: true,
        strategy: 'skip-retrieval',
        reason: `low_intent_short_utterance: ${lightChat.toFixed(2)}`,
        matchedKeywords: { lightChat },
        recommendedTools: this.config.strategyTools['skip-retrieval'] || []
      };
    }

    // Strategy 1: skip-retrieval (task-meta questions)
    // High confidence that this is about current task, answer from working memory
    if (isAboutCurrentTask || taskMeta >= this.config.minConfidenceForSkip) {
      return {
        category: 'task-meta',
        confidence: Math.max(taskMeta, isAboutCurrentTask ? 0.95 : 0.85),
        shouldShortCircuit: true,
        strategy: 'skip-retrieval',
        reason: isAboutCurrentTask 
          ? 'working_memory_match' 
          : `task_meta_keywords: ${taskMeta.toFixed(2)}`,
        matchedKeywords: { taskMeta },
        recommendedTools: this.config.strategyTools['skip-retrieval'] || []
      };
    }

    // Strategy 2: hot-only (continuation)
    // User wants to continue, no new context needed
    if (continuation >= this.config.minConfidenceForHotOnly) {
      return {
        category: 'continuation',
        confidence: continuation,
        shouldShortCircuit: false,
        strategy: 'hot-only',
        reason: `continuation_keywords: ${continuation.toFixed(2)}`,
        matchedKeywords: { continuation },
        recommendedTools: this.config.strategyTools['hot-only'] || []
      };
    }

    if (WEATHER_SIGNAL_RE.test(normalized)) {
      return {
        category: 'external',
        confidence: Math.max(external, 0.86),
        shouldShortCircuit: false,
        strategy: 'full-search',
        reason: 'weather_signal_detected',
        matchedKeywords: { external: Math.max(external, 0.86) },
        recommendedTools: ['web_search', 'web_fetch']
      };
    }

    // Strategy 3: deep-inspect (file operations)
    // Needs filesystem search - Phase 2
    if (deepInspect >= this.config.minConfidenceForHotOnly) {
      return {
        category: 'deep-inspect',
        confidence: deepInspect,
        shouldShortCircuit: false,
        strategy: 'deep-inspect',
        reason: `deep_inspect_keywords: ${deepInspect.toFixed(2)}`,
        matchedKeywords: { deepInspect },
        recommendedTools: this.config.strategyTools['deep-inspect'] || []
      };
    }

    // Strategy 4: full-search (external)
    // Needs web search - Phase 2
    if (external >= this.config.minConfidenceForHotOnly) {
      return {
        category: 'external',
        confidence: external,
        shouldShortCircuit: false,
        strategy: 'full-search',
        reason: `external_keywords: ${external.toFixed(2)}`,
        matchedKeywords: { external },
        recommendedTools: this.config.strategyTools['full-search'] || []
      };
    }

    // Default: indexed-only (knowledge questions)
    // Standard retrieval with BM25
    return {
      category: 'knowledge',
      confidence: 0.5,
      shouldShortCircuit: false,
      strategy: 'indexed-only',
      reason: 'default_knowledge_query',
      matchedKeywords: keywordScores,
      recommendedTools: this.config.strategyTools['indexed-only'] || []
    };
  }

  /**
   * Apply learning-based adjustments to scores (Phase 2)
   * @private
   */
  _applyLearningAdjustments(scores) {
    if (!this.config.learningEnabled) {
      return scores;
    }

    const adjusted = { ...scores };
    const { adjustmentFactors } = this.learningData;

    // Apply category-specific adjustments based on historical success
    for (const [category, factor] of Object.entries(adjustmentFactors)) {
      const scoreKey = category === 'task-meta' ? 'taskMeta' :
                       category === 'greeting' ? null :
                       category === 'light-chat' ? null :
                       category === 'continuation' ? 'continuation' :
                       category === 'external' ? 'external' :
                       category === 'deep-inspect' ? 'deepInspect' : null;
      
      if (scoreKey && adjusted[scoreKey] > 0) {
        adjusted[scoreKey] = Math.min(1.0, Math.max(0, adjusted[scoreKey] + (factor - 1)));
      }
    }

    return adjusted;
  }

  /**
   * Record outcome for learning (Phase 2)
   * @param {string} category - The classification category
   * @param {boolean} success - Whether the classification led to successful outcome
   * @param {string} [feedback] - Optional user feedback
   */
  recordOutcome(category, success, feedback = null) {
    if (!this.config.learningEnabled) {
      return;
    }

    // Update success/failure counts
    if (success) {
      this.learningData.successByCategory[category] = 
        (this.learningData.successByCategory[category] || 0) + 1;
    } else {
      this.learningData.failureByCategory[category] = 
        (this.learningData.failureByCategory[category] || 0) + 1;
    }

    // Track recent outcomes
    this.learningData.recentOutcomes.push({
      category,
      success,
      feedback,
      timestamp: Date.now()
    });

    // Keep only last 100
    if (this.learningData.recentOutcomes.length > 100) {
      this.learningData.recentOutcomes.shift();
    }

    // Recalculate adjustment factors
    this._recalculateAdjustmentFactors();

    logInfo('fast_awareness_outcome_recorded', {
      category,
      success,
      feedback: feedback ? feedback.substring(0, 50) : null
    });

    this._saveLearningData();
  }

  /**
   * Recalculate adjustment factors based on historical data (Phase 2)
   * @private
   */
  _recalculateAdjustmentFactors() {
    const factors = {};
    
    for (const category of ['greeting', 'light-chat', 'task-meta', 'continuation', 'external', 'deep-inspect', 'knowledge']) {
      const successes = this.learningData.successByCategory[category] || 0;
      const failures = this.learningData.failureByCategory[category] || 0;
      const total = successes + failures;

      if (total >= 5) {  // Need minimum data points
        // Base factor: success rate
        const successRate = successes / total;
        
        // Boost for high success rate, penalize for low
        // 0.8 = baseline (slight skepticism), 1.2 = strong confidence
        factors[category] = 0.8 + (successRate * 0.4);
        
        // Recent trend adjustment (last 10 outcomes)
        const recent = this.learningData.recentOutcomes
          .filter(o => o.category === category)
          .slice(-10);
        
        if (recent.length >= 3) {
          const recentSuccessRate = recent.filter(o => o.success).length / recent.length;
          // Adjust by 10% based on recent trend
          factors[category] += (recentSuccessRate - 0.5) * 0.2;
        }
        
        // Clamp to reasonable range
        factors[category] = Math.min(1.2, Math.max(0.8, factors[category]));
      }
    }

    this.learningData.adjustmentFactors = factors;
  }

  /**
   * Generate cache key
   * @private
   */
  _cacheKey(normalized) {
    // Simple hash for cache key
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const compactText = String(normalized || '').slice(0, 48).replace(/\s+/g, '_');
    return `class_${compactText}_${Math.abs(hash).toString(36)}`;
  }

  _isSimpleGreeting(normalized) {
    const score = this._scoreLowIntentFeatures(normalized).greeting;
    return score >= this.config.minFeatureGreetingScore;
  }

  _isLowIntentUtterance(normalized) {
    const score = this._scoreLowIntentFeatures(normalized).lowIntent;
    return score >= this.config.minFeatureLowIntentScore;
  }

  /**
   * Evict old cache entries
   * @private
   */
  _evictOldCacheEntries() {
    const now = Date.now();
    const maxAge = this.config.cacheHitWindowMs * 2;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.cache.delete(key);
      }
    }

    // Also limit by size
    if (this.cache.size > 1000) {
      // Remove oldest half
      const entries = [...this.cache.entries()]
        .sort((a, b) => b[1].timestamp - a[1].timestamp);
      this.cache = new Map(entries.slice(0, 500));
    }
  }

  /**
   * Return unknown/default result
   * @private
   */
  _unknownResult(reason) {
    return {
      category: 'unknown',
      confidence: 0,
      shouldShortCircuit: false,
      strategy: 'indexed-only',
      reason
    };
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    const totalLearned = Object.values(this.learningData.successByCategory).reduce((a, b) => a + b, 0) +
                         Object.values(this.learningData.failureByCategory).reduce((a, b) => a + b, 0);
    
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      learningEnabled: this.config.learningEnabled,
      totalLearnedOutcomes: totalLearned,
      adjustmentFactors: this.learningData.adjustmentFactors,
      recentSuccessRate: this.learningData.recentOutcomes.length > 0
        ? (this.learningData.recentOutcomes.filter(o => o.success).length / this.learningData.recentOutcomes.length).toFixed(2)
        : null
    };
  }

  /**
   * Export learning data for persistence
   * @returns {Object}
   */
  exportLearningData() {
    return {
      successByCategory: this.learningData.successByCategory,
      failureByCategory: this.learningData.failureByCategory,
      adjustmentFactors: this.learningData.adjustmentFactors,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import learning data from persistence
   * @param {Object} data - Previously exported learning data
   */
  importLearningData(data) {
    if (data?.successByCategory) {
      this.learningData.successByCategory = { ...data.successByCategory };
    }
    if (data?.failureByCategory) {
      this.learningData.failureByCategory = { ...data.failureByCategory };
    }
    if (data?.adjustmentFactors) {
      this.learningData.adjustmentFactors = { ...data.adjustmentFactors };
    }
    logInfo('fast_awareness_learning_imported', {
      categories: Object.keys(this.learningData.successByCategory).length
    });
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    logInfo('fast_awareness_cache_cleared');
  }

  /**
   * Load learning data from disk
   * @private
   */
  _loadLearningData() {
    if (!this.config.learningEnabled) return;
    
    try {
      const filePath = this.config.learningDataPath || getLearningDataPath();
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        this.importLearningData(data);
        logInfo('fast_awareness_learning_loaded', { path: filePath });
      }
    } catch (error) {
      logError('fast_awareness_learning_load_failed', { error: String(error.message || error) });
    }
  }

  /**
   * Save learning data to disk
   * @private
   */
  _saveLearningData() {
    if (!this.config.learningEnabled) return;
    
    try {
      const filePath = this.config.learningDataPath || getLearningDataPath();
      const data = this.exportLearningData();
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      logInfo('fast_awareness_learning_saved', { path: filePath });
    } catch (error) {
      logError('fast_awareness_learning_save_failed', { error: String(error.message || error) });
    }
  }

  /**
   * Write telemetry event to disk (append-only JSONL)
   * @param {Object} event - Telemetry event
   */
  writeTelemetry(event) {
    if (!this.config.telemetryEnabled) return;
    
    try {
      const filePath = getTelemetryPath();
      const line = JSON.stringify({
        ...event,
        ts: new Date().toISOString(),
        routerVersion: '1.0.0'
      }) + '\n';
      fs.appendFileSync(filePath, line);
    } catch (error) {
      logError('fast_awareness_telemetry_write_failed', { error: String(error.message || error) });
    }
  }

  /**
   * Get telemetry summary (reads last N lines)
   * @param {number} [limit=100] - Number of recent events
   * @returns {Object} Telemetry summary
   */
  getTelemetrySummary(limit = 100) {
    try {
      const filePath = getTelemetryPath();
      if (!fs.existsSync(filePath)) {
        return { total: 0, events: [] };
      }
      
      const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
      const recent = lines.slice(-limit).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      
      const categoryCounts = {};
      const strategyCounts = {};
      let totalLatency = 0;
      let count = 0;
      
      for (const event of recent) {
        if (event.category) categoryCounts[event.category] = (categoryCounts[event.category] || 0) + 1;
        if (event.strategy) strategyCounts[event.strategy] = (strategyCounts[event.strategy] || 0) + 1;
        if (event.latency) { totalLatency += event.latency; count++; }
      }
      
      return {
        total: lines.length,
        recentCount: recent.length,
        categoryCounts,
        strategyCounts,
        avgLatencyMs: count > 0 ? Math.round(totalLatency / count) : 0,
        lastEvent: recent[recent.length - 1] || null
      };
    } catch (error) {
      logError('fast_awareness_telemetry_read_failed', { error: String(error.message || error) });
      return { total: 0, error: String(error.message || error) };
    }
  }

  /**
   * Update working memory reference
   * @param {WorkingMemoryAnchor} workingMemory
   */
  setWorkingMemory(workingMemory) {
    this.workingMemory = workingMemory;
  }
}

/**
 * Factory function for creating router
 * @param {Object} config - Router config
 * @param {WorkingMemoryAnchor} workingMemory - Working memory instance
 * @returns {FastAwarenessRouter}
 */
export function createFastAwarenessRouter(config = {}, workingMemory = null) {
  return new FastAwarenessRouter(config, workingMemory);
}

export default FastAwarenessRouter;
