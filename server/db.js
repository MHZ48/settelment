const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'sessions.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    case_number TEXT PRIMARY KEY,
    title       TEXT,
    state       TEXT,
    created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )
`);

module.exports = {
  getAll() {
    return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all();
  },
  upsert(caseNum, title, state, updatedAt) {
    const stateStr = typeof state === 'object' ? JSON.stringify(state) : (state || '{}');
    db.prepare(`
      INSERT INTO sessions (case_number, title, state, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(case_number) DO UPDATE SET
        title      = excluded.title,
        state      = excluded.state,
        updated_at = excluded.updated_at
    `).run(caseNum, title || '', stateStr, updatedAt || new Date().toISOString());
  },
  remove(caseNum) {
    db.prepare('DELETE FROM sessions WHERE case_number = ?').run(caseNum);
  }
};
