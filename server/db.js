const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const databasePath = path.resolve(process.env.DB_PATH || path.join(__dirname, 'settlement.db'));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(`
 CREATE TABLE IF NOT EXISTS car_makes (id INTEGER PRIMARY KEY, make_name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS car_models (id INTEGER PRIMARY KEY, make_id INTEGER NOT NULL REFERENCES car_makes(id), model_name TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS models_make ON car_models(make_id);
 CREATE TABLE IF NOT EXISTS colors (id INTEGER PRIMARY KEY, color_name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS registration_types (id INTEGER PRIMARY KEY, type_name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS parts (id INTEGER PRIMARY KEY, part_name TEXT NOT NULL, default_price REAL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions (
   case_number TEXT PRIMARY KEY, title TEXT, state TEXT,
   created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
   updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 );
`);
module.exports = {
 db, databasePath,
 getAll() { return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all(); },
 upsert(caseNum, title, state, updatedAt) {
   db.prepare(`INSERT INTO sessions (case_number,title,state,updated_at) VALUES (?,?,?,?)
     ON CONFLICT(case_number) DO UPDATE SET title=excluded.title,state=excluded.state,updated_at=excluded.updated_at`)
     .run(caseNum, title || '', JSON.stringify(state), updatedAt || new Date().toISOString());
   return db.prepare('SELECT * FROM sessions WHERE case_number=?').get(caseNum);
 },
 remove(caseNum) { return db.prepare('DELETE FROM sessions WHERE case_number=?').run(caseNum); }
};
