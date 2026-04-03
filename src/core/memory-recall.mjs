/**
 * Memory Recall - Queries stored artifacts and surfaces relevant ones
 * Shadow mode: logs recalled artifacts without injecting into context
 */

function extractKeywords(text) {
  if (!text) return [];
  const stopWords = new Set([
    'the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could',
    'should','may','might','can','shall','to','of','in','for',
    'on','with','at','by','from','as','into','through','during',
    'before','after','above','below','between','and','but','or',
    'nor','not','so','yet','both','either','neither','each','every',
    'all','any','few','more','most','other','some','such','no',
    'only','own','same','than','too','very','just','because','if',
    'when','where','how','what','which','who','whom','this','that',
    'these','those','i','me','my','we','our','you','your','he','him',
    'his','she','her','it','its','they','them','their'
  ]);
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

export function recallRelevantArtifacts({ memoryStore, sessionId, currentGoal, limit = 5 }) {
  if (!memoryStore || typeof memoryStore.getMemoryArtifacts !== 'function') return [];
  
  let allArtifacts;
  try {
    allArtifacts = memoryStore.getMemoryArtifacts(sessionId, 100);
  } catch {
    return [];
  }
  
  if (!Array.isArray(allArtifacts) || allArtifacts.length === 0) return [];
  
  const goalWords = extractKeywords(currentGoal);
  if (goalWords.length === 0) return [];
  
  const scored = allArtifacts.map(a => {
    const content = String(a.content || a.text || '');
    const matched = goalWords.filter(w => content.toLowerCase().includes(w));
    return {
      type: a.type || 'unknown',
      content: content.slice(0, 200),
      sourceRef: a.sourceRef || a.source || 'unknown',
      relevance: matched.length / goalWords.length
    };
  });
  
  return scored
    .filter(a => a.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}

export function formatRecalledContext(artifacts) {
  if (!artifacts || artifacts.length === 0) return '';
  const lines = artifacts.map(a =>
    `[${a.type}] ${a.content}${a.sourceRef ? ` (ref: ${a.sourceRef})` : ''}`
  );
  return `\n## Recalled Memory\n${lines.join('\n')}\n`;
}
