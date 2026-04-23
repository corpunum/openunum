export class ChannelBase {
  constructor(config) {
    this.config = config;
  }

  get supportsStreaming() { return false; }
  get supportsHtml() { return false; }
  get supportsPhotos() { return false; }
  get supportsDocuments() { return false; }
  get supportsVoice() { return false; }

  escapeHtml(text) {
    return String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  stripMarkdown(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').replace(/```/g, ''))
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  }

  chunkMessage(text, maxLength = 4096) {
    const chunks = [];
    if (text.length <= maxLength) return [text];

    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';

    for (const para of paragraphs) {
      if ((currentChunk + '\n\n' + para).trim().length <= maxLength) {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        if (para.length > maxLength) {
          const lines = para.split('\n');
          currentChunk = '';
          for (const line of lines) {
            if ((currentChunk + '\n' + line).length <= maxLength) {
              currentChunk = currentChunk ? currentChunk + '\n' + line : line;
            } else {
              if (currentChunk) chunks.push(currentChunk.trim());
              if (line.length > maxLength) {
                for (let i = 0; i < line.length; i += maxLength - 100) {
                  chunks.push(line.slice(i, i + maxLength - 100));
                }
              } else {
                currentChunk = line;
              }
            }
          }
        } else {
          currentChunk = para;
        }
      }
    }

    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
  }
}