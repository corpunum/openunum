import fs from 'node:fs';
import path from 'node:path';
import { logInfo, logError } from '../logger.mjs';
import { generateEmbedding, rerankBySimilarity, checkEmbeddingsAvailable } from './embeddings.mjs';

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
  constructor({ workspaceRoot, bm25TopK = 20, finalTopK = 5 }) {
    this.workspaceRoot = workspaceRoot || process.cwd();
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
   * Load memory files from disk
   * @returns {Array<{id: string, text: string, metadata: object}>}
   */
  loadMemories() {
    const memories = [];
    
    if (!fs.existsSync(this.memoryDir)) {
      logInfo('memory_dir_not_found', { path: this.memoryDir });
      return memories;
    }

    const files = fs.readdirSync(this.memoryDir).filter(f => f.endsWith('.md') || f.endsWith('.json'));
    
    for (const file of files) {
      try {
        const filePath = path.join(this.memoryDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        let text = content;
        let metadata = { file };

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
        logError('memory_load_failed', { file, error: String(error.message || error) });
      }
    }

    logInfo('memories_loaded', { count: memories.length, dir: this.memoryDir });
    return memories;
  }

  /**
   * Hybrid retrieval: BM25 → Embeddings → Rerank
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
      // Return BM25 results only
      return bm25Candidates.slice(0, this.finalTopK).map(c => ({
        id: c.id,
        text: c.text,
        metadata: c.metadata,
        bm25Score: c.bm25Score,
        retrievalMethod: 'bm25_only'
      }));
    }

    // Step 2: Generate query embedding
    let queryEmbedding;
    try {
      queryEmbedding = await generateEmbedding(query);
      logInfo('query_embedding_generated', { dims: queryEmbedding.length });
    } catch (error) {
      logError('query_embedding_failed', { error: String(error.message || error) });
      
      if (fallbackToBM25) {
        return bm25Candidates.slice(0, this.finalTopK).map(c => ({
          id: c.id,
          text: c.text,
          metadata: c.metadata,
          bm25Score: c.bm25Score,
          retrievalMethod: 'bm25_fallback'
        }));
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

    // Step 5: Return top-K with scores
    const results = reranked.slice(0, this.finalTopK).map(c => ({
      id: c.id,
      text: c.text,
      metadata: c.metadata,
      bm25Score: c.bm25Score,
      similarity: c.similarity || 0,
      retrievalMethod: 'hybrid'
    }));

    logInfo('hybrid_retrieval_complete', { 
      query: query.slice(0, 50),
      results: results.length,
      avgSimilarity: results.reduce((s, r) => s + (r.similarity || 0), 0) / results.length
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
