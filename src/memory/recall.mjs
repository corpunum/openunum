import fs from 'node:fs';
import path from 'node:path';
import { logInfo, logError } from '../logger.mjs';
import { generateEmbedding, rerankBySimilarity, checkEmbeddingsAvailable } from './embeddings.mjs';
import { calculateFreshness, getHalfLifeForCategory } from './freshness-decay.mjs';

/**
 * Hybrid Memory Retrieval Pipeline
 * 
 * Pipeline:
 * 1. BM25 keyword search (top-20 candidates)
 * 2. Embedding generation for query + top candidates
 * 3. Cosine similarity reranking
 * 4. Return top-5 results
 * 
 * Fallback: BM25-only if embeddings fail
 */

export class HybridRetriever {
  constructor({ workspaceRoot, memoryStore = null, bm25TopK = 20, finalTopK = 5 }) {
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.memoryStore = memoryStore;
    this.bm25TopK = bm25TopK;
    this.finalTopK = finalTopK;
    this.embeddingsAvailable = null;
    this.memoryDir = path.join(this.workspaceRoot, 'data', 'memory');
  }

  /**
   * Check if embeddings are available (cached result)
   */
  async checkEmbeddingsAvailable() {
    if (this.embeddingsAvailable === null) {
      this.embeddingsAvailable = await checkEmbeddingsAvailable();
      logInfo('embeddings_availability_check', { available: this.embeddingsAvailable });
    }
    return this.embeddingsAvailable;
  }

  /**
   * Simple BM25-like scoring (keyword frequency + inverse doc frequency)
   * @param {string} query 
   * @param {Array<{id: string, text: string, metadata?: object}>} documents 
   * @returns {Array<typeof documents[0] & {bm25Score: number}>}
   */
  bm25Search(query, documents) {
    const queryTerms = String(query || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
    
    if (queryTerms.length === 0) {
      return documents.map(d => ({ ...d, bm25Score: 0 }));
    }

    // Calculate IDF for each term
    const idf = new Map();
    for (const term of queryTerms) {
      let docCount = 0;
      for (const doc of documents) {
        if (String(doc.text || '').toLowerCase().includes(term)) {
          docCount++;
        }
      }
      // IDF with smoothing
      idf.set(term, Math.log(1 + documents.length / (docCount + 1)));
    }

    // Score each document
    const scored = documents.map(doc => {
      const text = String(doc.text || '').toLowerCase();
      let score = 0;

      for (const term of queryTerms) {
        const termFreq = (text.match(new RegExp(term, 'g')) || []).length;
        const idfScore = idf.get(term) || 0;
        score += termFreq * idfScore * (1 + termFreq); // TF-IDF with term frequency boost
      }

      return { ...doc, bm25Score: score };
    });

    // Sort by BM25 score and take top-K
    scored.sort((a, b) => b.bm25Score - a.bm25Score);
    return scored.slice(0, this.bm25TopK);
  }

  /**
   * Load memories from both flat files and SQLite store.
   * @returns {Array<{id: string, text: string, metadata: object}>}
   */
  loadMemories() {
    const memories = [];
    
    // 1. Load from SQLite MemoryStore (New Bridge)
    if (this.memoryStore && typeof this.memoryStore.getAllSearchableRecords === 'function') {
      try {
        const records = this.memoryStore.getAllSearchableRecords(500);
        for (const r of records) {
          memories.push({
            id: r.id,
            text: r.text,
            metadata: { type: r.type, source: 'sqlite', createdAt: r.createdAt }
          });
        }
        logInfo('memories_loaded_from_sqlite', { count: records.length });
      } catch (error) {
        logError('sqlite_memory_load_failed', { error: String(error.message || error) });
      }
    }

    // 2. Load from flat files (Legacy/Archive)
    if (fs.existsSync(this.memoryDir)) {
      const files = fs.readdirSync(this.memoryDir).filter(f => f.endsWith('.md') || f.endsWith('.json'));
      
      for (const file of files) {
        try {
          const filePath = path.join(this.memoryDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          
          let text = content;
          let metadata = { file, source: 'fs' };

          if (file.endsWith('.json')) {
            const parsed = JSON.parse(content);
            text = parsed.text || parsed.content || content;
            metadata = { ...metadata, ...parsed };
          }

          memories.push({
            id: file.replace(/\.(md|json)$/, ''),
            text,
            metadata
          });
        } catch (error) {
          logError('fs_memory_load_failed', { file, error: String(error.message || error) });
        }
      }
      logInfo('memories_loaded_from_fs', { count: files.length, dir: this.memoryDir });
    }

    return memories;
  }

  /**
   * Hybrid retrieval: BM25 → Embeddings → Rerank → Freshness Decay
   * @param {string} query
   * @param {object} options
   * @returns {Promise<Array<{id: string, text: string, metadata: object, bm25Score?: number, similarity?: number}>>}
   */
  async retrieve(query, options = {}) {
    const {
      useHybrid = true,
      fallbackToBM25 = true
    } = options;

    // Load all memories
    const memories = this.loadMemories();
    if (memories.length === 0) {
      return [];
    }

    // Step 1: BM25 search (always)
    const bm25Candidates = this.bm25Search(query, memories);
    logInfo('bm25_search_complete', { queryLen: query.length, candidates: bm25Candidates.length });

    // Check if we should use hybrid
    const canUseEmbeddings = useHybrid && await this.checkEmbeddingsAvailable();

    if (!canUseEmbeddings) {
      logInfo('using_bm25_only', { reason: !useHybrid ? 'hybrid_disabled' : 'embeddings_unavailable' });
      // Return BM25 results with freshness decay applied
      return this.applyFreshnessAndReturn(bm25Candidates, 'bm25_only');
    }

    // Step 2: Generate query embedding
    let queryEmbedding;
    try {
      queryEmbedding = await generateEmbedding(query);
      logInfo('query_embedding_generated', { dims: queryEmbedding.length });
    } catch (error) {
      logError('query_embedding_failed', { error: String(error.message || error) });

      if (fallbackToBM25) {
        return this.applyFreshnessAndReturn(bm25Candidates, 'bm25_fallback');
      }

      throw error;
    }

    // Step 3: Generate embeddings for BM25 candidates
    const candidatesWithEmbeddings = [];
    for (const candidate of bm25Candidates) {
      try {
        const embedding = await generateEmbedding(candidate.text.slice(0, 500)); // Truncate for speed
        candidatesWithEmbeddings.push({
          ...candidate,
          embedding
        });
      } catch (error) {
        logError('candidate_embedding_failed', { id: candidate.id, error: String(error.message || error) });
        candidatesWithEmbeddings.push({
          ...candidate,
          embedding: null
        });
      }
    }

    // Step 4: Rerank by cosine similarity
    const reranked = rerankBySimilarity(queryEmbedding, candidatesWithEmbeddings);
    logInfo('reranking_complete', { candidates: reranked.length });

    // Step 5: Apply freshness decay and return top-K
    return this.applyFreshnessAndReturn(reranked, 'hybrid');
  }

  /**
   * Apply freshness decay to scored candidates and return top-K.
   * Freshness is applied with 30% weight as documented in BRAIN.MD/OPENUNUM_EXPLAINED.md.
   * @param {Array} candidates - Candidates with bm25Score and optionally similarity
   * @param {string} retrievalMethod - Tag for the retrieval method used
   * @returns {Array} Top-K results with freshness-adjusted scores
   */
  applyFreshnessAndReturn(candidates, retrievalMethod) {
    const FRESHNESS_WEIGHT = 0.3;
    const now = Date.now();

    // Apply freshness decay to each candidate
    const withFreshness = candidates.map(c => {
      const category = c.metadata?.type || c.metadata?.category || 'default';
      const createdAtStr = c.metadata?.createdAt || c.metadata?.created_at;
      const createdAtMs = createdAtStr ? new Date(createdAtStr).getTime() : now;
      const halfLifeMs = getHalfLifeForCategory(category);
      const freshness = Number.isFinite(createdAtMs) ? calculateFreshness(createdAtMs, halfLifeMs) : 1.0;

      // Combine scores: 70% base relevance + 30% freshness
      const baseScore = c.similarity ?? (c.bm25Score / (Math.max(...candidates.map(x => x.bm25Score || 0)) || 1));
      const combinedScore = baseScore * (1 - FRESHNESS_WEIGHT) + freshness * FRESHNESS_WEIGHT;

      return {
        id: c.id,
        text: c.text,
        metadata: c.metadata,
        bm25Score: c.bm25Score,
        similarity: c.similarity || 0,
        freshness,
        freshnessCategory: category,
        combinedScore,
        retrievalMethod
      };
    });

    // Re-sort by combined score (freshness can change ranking)
    withFreshness.sort((a, b) => b.combinedScore - a.combinedScore);

    const results = withFreshness.slice(0, this.finalTopK);

    logInfo('freshness_decay_applied', {
      retrievalMethod,
      results: results.length,
      avgFreshness: results.reduce((s, r) => s + (r.freshness || 0), 0) / (results.length || 1),
      avgCombinedScore: results.reduce((s, r) => s + (r.combinedScore || 0), 0) / (results.length || 1)
    });

    return results;
  }

  /**
   * Simple search (BM25 only, no embeddings)
   * @param {string} query 
   * @param {number} limit 
   * @returns {Array<{id: string, text: string, metadata: object, bm25Score: number}>}
   */
  async searchSimple(query, limit = 10) {
    const memories = this.loadMemories();
    const results = this.bm25Search(query, memories);
    return results.slice(0, limit).map(c => ({
      id: c.id,
      text: c.text,
      metadata: c.metadata,
      bm25Score: c.bm25Score
    }));
  }
}

/**
 * Factory function for easy import
 */
export function createHybridRetriever(options) {
  return new HybridRetriever(options);
}
