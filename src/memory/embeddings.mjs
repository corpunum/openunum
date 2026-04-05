import { logInfo, logError } from '../logger.mjs';

/**
 * Embedding Service via Ollama
 * Uses nomic-embed-text for semantic retrieval
 */

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';

let cache = new Map();
const CACHE_MAX = 1000;

/**
 * Generate embedding for a single text
 * @param {string} text 
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Empty text for embedding');
  }

  // Check cache
  const cacheKey = `emb:${trimmed}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: trimmed
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings API returned ${response.status}`);
    }

    const data = await response.json();
    const embedding = data.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Invalid embedding response from Ollama');
    }

    // Cache result
    if (cache.size >= CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    cache.set(cacheKey, embedding);

    logInfo('embedding_generated', { model: EMBEDDING_MODEL, dims: embedding.length, textLen: trimmed.length });
    return embedding;

  } catch (error) {
    logError('embedding_failed', { error: String(error.message || error), textLen: trimmed.length });
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts (batched)
 * @param {string[]} texts 
 * @returns {Promise<number[][]>}
 */
export async function generateEmbeddingsBatch(texts) {
  const results = [];
  for (const text of texts) {
    try {
      const emb = await generateEmbedding(text);
      results.push(emb);
    } catch (error) {
      logError('batch_embedding_partial_failure', { text, error: String(error.message || error) });
      results.push(null); // Placeholder for failed embeddings
    }
  }
  return results;
}

/**
 * Cosine similarity between two vectors
 * @param {number[]} a 
 * @param {number[]} b 
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vector dimension mismatch');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Rerank candidates by similarity to query
 * @param {number[]} queryEmbedding 
 * @param {Array<{text: string, embedding: number[], score?: number}>} candidates 
 * @returns {Array<typeof candidates[0]>}
 */
export function rerankBySimilarity(queryEmbedding, candidates) {
  const scored = candidates.map(c => {
    if (!c.embedding) {
      return { ...c, similarity: 0 };
    }
    const sim = cosineSimilarity(queryEmbedding, c.embedding);
    return { ...c, similarity: sim };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored;
}

/**
 * Check if Ollama embeddings endpoint is available
 * @returns {Promise<boolean>}
 */
export async function checkEmbeddingsAvailable() {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!response.ok) return false;
    
    const data = await response.json();
    const models = data.models || [];
    return models.some(m => String(m.name || '').includes('nomic-embed'));
  } catch {
    return false;
  }
}
