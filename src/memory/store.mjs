import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir, ensureHome } from '../config.mjs';

export class MemoryStore {
  constructor() {
    ensureHome();
    this.filePath = path.join(getHomeDir(), 'openunum-memory.json');
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      return { sessions: {}, facts: [] };
    }
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return { sessions: {}, facts: [] };
    }
  }

  persist() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  ensureSession(sessionId) {
    if (!this.state.sessions[sessionId]) {
      this.state.sessions[sessionId] = { created_at: new Date().toISOString(), messages: [] };
      this.persist();
    }
  }

  addMessage(sessionId, role, content) {
    this.ensureSession(sessionId);
    this.state.sessions[sessionId].messages.push({
      role,
      content,
      created_at: new Date().toISOString()
    });
    this.persist();
  }

  getMessages(sessionId, limit = 50) {
    const s = this.state.sessions[sessionId];
    if (!s) return [];
    return s.messages.slice(-limit);
  }

  rememberFact(key, value) {
    this.state.facts.push({ key, value, created_at: new Date().toISOString() });
    this.persist();
  }

  retrieveFacts(query, limit = 5) {
    const q = query.toLowerCase();
    return this.state.facts
      .filter((f) => f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q))
      .slice(-limit)
      .reverse();
  }
}

