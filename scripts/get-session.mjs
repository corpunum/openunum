import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/home/corp-unum/openunum/openunum.db');

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
