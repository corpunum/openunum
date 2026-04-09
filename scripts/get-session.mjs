import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const dbPath = process.env.OPENUNUM_DB
  || path.join(process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum'), 'openunum.db');
const db = new DatabaseSync(dbPath);
console.log('DB path:', dbPath);

// Check if tables exist
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', JSON.stringify(tables));

// Check session count
try {
  const count = db.prepare('SELECT COUNT(*) as c FROM sessions').get();
  console.log('Sessions:', count);
} catch(e) {
  console.log('Sessions error:', e.message);
}

db.close();
