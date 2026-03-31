import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir } from '../config.mjs';
import { logInfo, logWarn, logError } from '../logger.mjs';

/**
 * PredictiveFailureDetector
 * Analyzes system patterns to predict failures before they occur
 * 
 * Features:
 * - Trend analysis for resource usage
 * - Pattern recognition for error sequences
 * - Early warning system with confidence scores
 * - Automated mitigation recommendations
 */
export class PredictiveFailureDetector {
  constructor({ memoryStore, config }) {
    this.memoryStore = memoryStore;
    this.config = config;
    this.homeDir = getHomeDir();
    this.historyPath = path.join(this.homeDir, 'failure-history.json');
    this.history = this.loadHistory();
    
    // Detection thresholds
    this.thresholds = {
      diskGrowthRatePercentPerHour: 5,
      memoryLeakRateMBPerHour: 100,
      errorRatePerMinute: 3,
      responseTimeDegradationMs: 1000,
      consecutiveSlowResponses: 5
    };
    
    // Tracking state
    this.resourceHistory = [];
    this.errorHistory = [];
    this.responseTimeHistory = [];
    this.maxHistorySize = 1000;
  }
  
  loadHistory() {
    try {
      if (fs.existsSync(this.historyPath)) {
        return JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
      }
    } catch (error) {
      logWarn('failed_to_load_failure_history', { error: String(error.message || error) });
    }
    return { predictions: [], actualFailures: [], accuracy: 0 };
  }
  
  saveHistory() {
    try {
      // Keep only last 500 entries
      if (this.history.predictions.length > 500) {
        this.history.predictions = this.history.predictions.slice(-500);
      }
      if (this.history.actualFailures.length > 500) {
        this.history.actualFailures = this.history.actualFailures.slice(-500);
      }
      
      // Calculate accuracy
      const recentPredictions = this.history.predictions.slice(-100);
      const matchedFailures = recentPredictions.filter(p => 
        this.history.actualFailures.some(f => 
          f.type === p.predictedType && 
          Math.abs(f.timestamp - p.timestamp) < 3600000 // Within 1 hour
        )
      ).length;
      
      this.history.accuracy = recentPredictions.length > 0 
        ? matchedFailures / recentPredictions.length 
        : 0;
      
      fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2));
    } catch (error) {
      logError('failed_to_save_failure_history', { error: String(error.message || error) });
    }
  }
  
  /**
   * Record resource metrics for trend analysis
   */
  recordResourceMetrics(metrics) {
    const entry = {
      timestamp: Date.now(),
      diskUsagePercent: metrics.diskUsagePercent,
      memoryUsageMB: metrics.memoryUsageMB,
      memoryAvailableMB: metrics.memoryAvailableMB,
      cpuUsagePercent: metrics.cpuUsagePercent
    };
    
    this.resourceHistory.push(entry);
    if (this.resourceHistory.length > this.maxHistorySize) {
      this.resourceHistory.shift();
    }
    
    return this.analyzeResourceTrends();
  }
  
  /**
   * Record error for pattern analysis
   */
  recordError(error) {
    const entry = {
      timestamp: Date.now(),
      type: error.type || 'unknown',
      message: String(error.message || error).substring(0, 200),
      context: error.context || {}
    };
    
    this.errorHistory.push(entry);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
    
    return this.analyzeErrorPatterns();
  }
  
  /**
   * Record response time for performance degradation detection
   */
  recordResponseTime(responseTimeMs) {
    const entry = {
      timestamp: Date.now(),
      responseTimeMs
    };
    
    this.responseTimeHistory.push(entry);
    if (this.responseTimeHistory.length > this.maxHistorySize) {
      this.responseTimeHistory.shift();
    }
    
    return this.analyzeResponseTimeTrends();
  }
  
  /**
   * Analyze resource usage trends
   */
  analyzeResourceTrends() {
    const predictions = [];
    
    if (this.resourceHistory.length < 10) {
      return predictions; // Need more data
    }
    
    // Analyze disk usage trend
    const recentDisk = this.resourceHistory.slice(-10).map(r => r.diskUsagePercent);
    const diskGrowthRate = this.calculateGrowthRate(recentDisk);
    
    if (diskGrowthRate > this.thresholds.diskGrowthRatePercentPerHour) {
      const hoursUntilFull = (100 - recentDisk[recentDisk.length - 1]) / diskGrowthRate;
      if (hoursUntilFull < 24) {
        predictions.push({
          type: 'disk_space_exhaustion',
          severity: hoursUntilFull < 6 ? 'critical' : 'warning',
          confidence: Math.min(0.95, 0.5 + (1 / hoursUntilFull)),
          predictedFailureIn: `${hoursUntilFull.toFixed(1)} hours`,
          currentValue: recentDisk[recentDisk.length - 1],
          growthRate: diskGrowthRate,
          recommendation: 'cleanup_logs_and_temp_files'
        });
      }
    }
    
    // Analyze memory trend
    const recentMemory = this.resourceHistory.slice(-10).map(r => r.memoryAvailableMB);
    const memoryDepletionRate = this.calculateDepletionRate(recentMemory);
    
    if (memoryDepletionRate > this.thresholds.memoryLeakRateMBPerHour) {
      const hoursUntilCritical = recentMemory[recentMemory.length - 1] / memoryDepletionRate;
      if (hoursUntilCritical < 12) {
        predictions.push({
          type: 'memory_exhaustion',
          severity: hoursUntilCritical < 4 ? 'critical' : 'warning',
          confidence: Math.min(0.9, 0.4 + (2 / hoursUntilCritical)),
          predictedFailureIn: `${hoursUntilCritical.toFixed(1)} hours`,
          currentValue: recentMemory[recentMemory.length - 1],
          depletionRate: memoryDepletionRate,
          recommendation: 'restart_service_or_force_gc'
        });
      }
    }
    
    return predictions;
  }
  
  /**
   * Analyze error patterns for recurring issues
   */
  analyzeErrorPatterns() {
    const predictions = [];
    
    if (this.errorHistory.length < 5) {
      return predictions;
    }
    
    // Check for error rate spike
    const now = Date.now();
    const errorsLastMinute = this.errorHistory.filter(
      e => (now - e.timestamp) < 60000
    ).length;
    
    if (errorsLastMinute > this.thresholds.errorRatePerMinute) {
      predictions.push({
        type: 'error_rate_spike',
        severity: errorsLastMinute > 10 ? 'critical' : 'warning',
        confidence: Math.min(0.95, errorsLastMinute / (this.thresholds.errorRatePerMinute * 3)),
        currentValue: errorsLastMinute,
        threshold: this.thresholds.errorRatePerMinute,
        recommendation: 'investigate_root_cause_immediately'
      });
    }
    
    // Check for recurring error pattern
    const errorCounts = {};
    for (const error of this.errorHistory.slice(-50)) {
      errorCounts[error.type] = (errorCounts[error.type] || 0) + 1;
    }
    
    for (const [type, count] of Object.entries(errorCounts)) {
      if (count >= 5 && type !== 'unknown') {
        predictions.push({
          type: 'recurring_error',
          severity: count >= 10 ? 'high' : 'medium',
          confidence: Math.min(0.9, count / 20),
          errorType: type,
          occurrenceCount: count,
          recommendation: `fix_${type}_root_cause`
        });
      }
    }
    
    return predictions;
  }
  
  /**
   * Analyze response time trends
   */
  analyzeResponseTimeTrends() {
    const predictions = [];
    
    if (this.responseTimeHistory.length < 10) {
      return predictions;
    }
    
    const recent = this.responseTimeHistory.slice(-20);
    const avgRecent = recent.reduce((sum, r) => sum + r.responseTimeMs, 0) / recent.length;
    const older = this.responseTimeHistory.slice(-40, -20);
    const avgOlder = older.reduce((sum, r) => sum + r.responseTimeMs, 0) / older.length;
    
    const degradation = avgRecent - avgOlder;
    
    if (degradation > this.thresholds.responseTimeDegradationMs) {
      predictions.push({
        type: 'performance_degradation',
        severity: degradation > 5000 ? 'high' : 'medium',
        confidence: Math.min(0.85, degradation / (this.thresholds.responseTimeDegradationMs * 5)),
        currentAvgMs: Math.round(avgRecent),
        previousAvgMs: Math.round(avgOlder),
        degradationMs: Math.round(degradation),
        recommendation: 'profile_and_optimize_slow_operations'
      });
    }
    
    // Check for consecutive slow responses
    const slowCount = recent.filter(r => r.responseTimeMs > 3000).length;
    if (slowCount >= this.thresholds.consecutiveSlowResponses) {
      predictions.push({
        type: 'consecutive_slow_responses',
        severity: 'warning',
        confidence: slowCount / 20,
        slowCount,
        totalRecent: recent.length,
        recommendation: 'check_external_dependencies_and_resources'
      });
    }
    
    return predictions;
  }
  
  /**
   * Calculate growth rate (percent per hour)
   */
  calculateGrowthRate(values) {
    if (values.length < 2) return 0;
    
    const first = values[0];
    const last = values[values.length - 1];
    const timeSpanHours = (values.length - 1) / 6; // Assuming 10-min intervals
    
    if (timeSpanHours <= 0) return 0;
    
    return ((last - first) / timeSpanHours);
  }
  
  /**
   * Calculate depletion rate (MB per hour)
   */
  calculateDepletionRate(values) {
    if (values.length < 2) return 0;
    
    const first = values[0];
    const last = values[values.length - 1];
    const timeSpanHours = (values.length - 1) / 6;
    
    if (timeSpanHours <= 0) return 0;
    
    return ((first - last) / timeSpanHours);
  }
  
  /**
   * Record actual failure for accuracy tracking
   */
  recordActualFailure(failure) {
    this.history.actualFailures.push({
      timestamp: Date.now(),
      type: failure.type,
      severity: failure.severity,
      details: failure.details
    });
    this.saveHistory();
  }
  
  /**
   * Record prediction for accuracy tracking
   */
  recordPrediction(prediction) {
    this.history.predictions.push({
      timestamp: Date.now(),
      predictedType: prediction.type,
      severity: prediction.severity,
      confidence: prediction.confidence,
      predictedFailureIn: prediction.predictedFailureIn
    });
    this.saveHistory();
  }
  
  /**
   * Get prediction accuracy statistics
   */
  getAccuracyStats() {
    return {
      totalPredictions: this.history.predictions.length,
      totalFailures: this.history.actualFailures.length,
      accuracy: this.history.accuracy,
      recentAccuracy: this.history.predictions.slice(-50).filter(p =>
        this.history.actualFailures.some(f =>
          f.type === p.predictedType &&
          Math.abs(f.timestamp - p.timestamp) < 3600000
        )
      ).length / Math.max(1, this.history.predictions.slice(-50).length)
    };
  }
  
  /**
   * Get all current predictions
   */
  getCurrentPredictions() {
    const resourcePredictions = this.analyzeResourceTrends();
    const errorPredictions = this.analyzeErrorPatterns();
    const responsePredictions = this.analyzeResponseTimeTrends();
    
    return [...resourcePredictions, ...errorPredictions, ...responsePredictions];
  }
}
