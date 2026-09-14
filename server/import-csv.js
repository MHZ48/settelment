require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const Database = require('better-sqlite3');
const { db, databasePath } = require('./db');
const schemas = {
 car_makes: ['id','make_name'], car_models: ['id','make_id','model_name'],
 colors: ['id','color_name'], registration_types: ['id','type_name'],
 parts: ['id','part_name','default_price'],
 sessions: ['case_number','title','state','created_at','updated_at']
};
async function main() {
 const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'Bashar Data base'));
 const datasets = Object.entries(schemas).map(([table, columns]) => {
   const file = [table + '_rows.csv', table + '.csv'].map(f => path.join(dir,f)).find(f => fs.existsSync(f));
   if (!file) throw new Error(`Missing CSV for ${table} in ${dir}`);
   const rows = parse(fs.readFileSync(file, 'utf8'), { bom:true, skip_empty_lines:true });
   const header = rows.shift() || [];
   for (const c of columns) if (!header.includes(c)) throw new Error(`${file}: missing required column ${c}`);
   const seen = new Set();
   const values = rows.map((row,i) => {
     const record = Object.fromEntries(header.map((c,j) => [c,row[j]]));
     if (row.length !== header.length) throw new Error(`${table} row ${i+2}: invalid column count`);
     for (const c of ['id','make_id'].filter(c => columns.includes(c))) {
       if (!/^\d+$/.test(record[c]) || !Number.isSafeInteger(Number(record[c]))) throw new Error(`${table} row ${i+2}: invalid ${c}`);
       record[c] = Number(record[c]);
     }
     const key = record.id ?? record.case_number;
     if (!key || seen.has(key)) throw new Error(`${table} row ${i+2}: empty or duplicate primary key`);
     seen.add(key);
     if (table === 'sessions') {
       if (record.state) JSON.parse(record.state); else record.state = '{}';
       for (const c of ['created_at','updated_at']) if (!Number.isFinite(Date.parse(record[c]))) throw new Error(`${table} row ${i+2}: invalid ${c}`);
     }
     if (table === 'parts') {
       record.default_price = record.default_price === '' ? null : Number(record.default_price);
       if (record.default_price !== null && !Number.isFinite(record.default_price)) throw new Error(`parts row ${i+2}: invalid default_price`);
     }
     return columns.map(c => record[c]);
   });
   return {table,columns,values};
 });
 const backup = databasePath + '.backup-' + Date.now();
 await db.backup(backup);
 console.log(`Backup: ${backup}`);
 const legacyPath = path.join(__dirname,'sessions.db');
 let legacyRows = [];
 if (fs.existsSync(legacyPath) && path.resolve(legacyPath) !== databasePath) {
   const legacy = new Database(legacyPath, { readonly:true });
   try { await legacy.backup(legacyPath + '.backup-' + Date.now()); legacyRows = legacy.prepare('SELECT * FROM sessions').all(); }
   finally { legacy.close(); }
 }
 db.transaction(() => {
   // Existing local records win; re-imports never undo edits or overwrite local sessions.
   const legacyInsert = db.prepare('INSERT INTO sessions (case_number,title,state,created_at,updated_at) VALUES (@case_number,@title,@state,@created_at,@updated_at) ON CONFLICT(case_number) DO NOTHING');
   for (const row of legacyRows) legacyInsert.run(row);
   for (const {table,columns,values} of datasets) {
     const key = table === 'sessions' ? 'case_number' : 'id';
     const insert = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')}) ON CONFLICT(${key}) DO NOTHING`);
     let imported = 0;
     for (const row of values) imported += insert.run(...row).changes;
     console.log(`${table}: ${imported} imported, ${values.length-imported} existing, ${db.prepare(`SELECT count(*) n FROM ${table}`).get().n} total`);
   }
   if (db.pragma('foreign_key_check').length) throw new Error('Foreign-key validation failed');
   if (db.pragma('integrity_check', {simple:true}) !== 'ok') throw new Error('Integrity check failed');
 })();
 console.log('Integrity and foreign-key checks passed.');
}
main().catch(e => { console.error('Import failed (transaction rolled back):', e.message); process.exitCode=1; }).finally(()=>db.close());
