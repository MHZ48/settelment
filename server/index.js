require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const store = require('./db');
const db = store.db;
const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
const username = process.env.AUTH_USER || '';
const password = process.env.AUTH_PASSWORD || '';
if (!!username !== !!password) throw new Error('Set both AUTH_USER and AUTH_PASSWORD');
if ((process.env.NODE_ENV === 'production' || !['127.0.0.1','localhost','::1'].includes(HOST)) && !password)
  throw new Error('Authentication is required for production or a non-loopback listener');
const origins = (process.env.CORS_ORIGINS || 'http://localhost:3001,http://127.0.0.1:3001').split(',').map(s=>s.trim()).filter(Boolean);
app.disable('x-powered-by');
app.use(cors({ credentials:true, origin(origin,cb) {
  if (!origin || origins.includes(origin)) return cb(null,true);
  const error = new Error('Origin not allowed'); error.status=403; cb(error);
} }));
app.use(express.json({ limit:'50mb' }));
app.get('/api/health', (req,res) => { db.prepare('SELECT count(*) FROM sessions').get(); res.json({ok:true,database:'sqlite'}); });
function equal(a,b) { return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest()); }
app.use('/api', (req,res,next) => {
  res.setHeader('Cache-Control','no-store');
  if (!password) return next();
  const header = req.headers.authorization || '';
  const expected = Buffer.from(`${username}:${password}`).toString('base64');
  if (equal(header,`Basic ${expected}`)) return next();
  res.setHeader('WWW-Authenticate','Basic realm="Settlement", charset="UTF-8"');
  res.status(401).json({error:'Authentication required. Open the API /api/login URL and sign in, then reload the application.'});
});
app.get('/api/login', (req,res)=>res.json({ok:true,message:'Signed in. Return to the application and reload.'}));
const clients = new Set();
function broadcast(event,data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) { if (!client.destroyed) client.write(message); else clients.delete(client); }
}
app.get('/api/sessions/stream',(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.flushHeaders(); res.write(': connected\n\n'); clients.add(res);
  const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),20000);
  req.on('close',()=>{ clearInterval(heartbeat); clients.delete(res); });
});
app.get('/api/sessions',(req,res)=>{
  const result=Object.create(null);
  for (const row of store.getAll()) {
    result[row.case_number]={caseNumber:row.case_number,title:row.title,createdAt:row.created_at,updatedAt:row.updated_at,state:JSON.parse(row.state || '{}')};
  }
  res.json(result);
});
function validCase(body) { return body && typeof body.caseNum === 'string' && body.caseNum.trim() && body.caseNum.length<=300 && !['__proto__','constructor','prototype'].includes(body.caseNum); }
app.post('/api/sessions/upsert',(req,res)=>{
  const body=req.body;
  if (!validCase(body) || !body.state || typeof body.state!=='object' || Array.isArray(body.state) || (body.title!=null && typeof body.title!=='string') || (body.updatedAt!=null && (typeof body.updatedAt!=='string' || !Number.isFinite(Date.parse(body.updatedAt)))))
    return res.status(400).json({error:'Valid caseNum, object state, title and timestamp required'});
  const existed=db.prepare('SELECT 1 FROM sessions WHERE case_number=?').get(body.caseNum);
  const row=store.upsert(body.caseNum,body.title,body.state,body.updatedAt);
  broadcast('upsert',{caseNum:row.case_number,title:row.title,state:JSON.parse(row.state),createdAt:row.created_at,updatedAt:row.updated_at});
  res.status(existed?200:201).json({ok:true});
});
app.post('/api/sessions/delete',(req,res)=>{
  if (!validCase(req.body)) return res.status(400).json({error:'caseNum required'});
  store.remove(req.body.caseNum);
  broadcast('delete',{caseNum:req.body.caseNum}); res.json({ok:true});
});
const tables={car_makes:['make_name'],car_models:['make_id','model_name'],colors:['color_name'],registration_types:['type_name'],parts:['part_name','default_price']};
function validRecord(table,body,partial=false) {
  if (!body || typeof body!=='object' || Array.isArray(body)) return false;
  const fields=tables[table];
  if (!Object.keys(body).length || Object.keys(body).some(k=>!fields.includes(k))) return false;
  return fields.every(k=> {
    if (!(k in body)) return partial || k==='default_price';
    if (k==='make_id') return Number.isSafeInteger(body[k]) && body[k]>0;
    if (k==='default_price') return body[k]===null || (typeof body[k]==='number' && Number.isFinite(body[k]));
    return typeof body[k]==='string' && !!body[k].trim() && body[k].length<=1000;
  });
}
for (const [table,fields] of Object.entries(tables)) {
  const route='/api/'+table;
  app.get(route,(req,res)=>{
    let sql=`SELECT * FROM ${table}`; const params=[];
    if (table==='car_makes' && req.query.make_name!==undefined) {
      if (typeof req.query.make_name!=='string') return res.status(400).json({error:'Invalid make_name'});
      sql+=' WHERE make_name=?'; params.push(req.query.make_name.replace(/^eq\./,''));
    }
    if (table==='car_models' && req.query.make_id!==undefined) {
      if (!/^\d+$/.test(req.query.make_id)) return res.status(400).json({error:'Invalid make_id'});
      sql+=' WHERE make_id=?'; params.push(Number(req.query.make_id));
    }
    res.json(db.prepare(sql+' ORDER BY id').all(...params));
  });
  app.post(route,(req,res)=>{
    if (!validRecord(table,req.body)) return res.status(400).json({error:'Invalid or missing fields'});
    const row=db.transaction(()=>{
      const identity=fields.filter(k=>k!=='default_price');
      const existing=db.prepare(`SELECT * FROM ${table} WHERE ${identity.map(k=>`${k}=?`).join(' AND ')}`).get(...identity.map(k=>req.body[k]));
      if (existing) return {existing:true,value:existing};
      const keys=Object.keys(req.body);
      const result=db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>req.body[k]));
      return {value:db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(result.lastInsertRowid)};
    })();
    res.status(row.existing?200:201).json([row.value]);
  });
  app.put(route+'/:id',(req,res)=>{
    if (!/^\d+$/.test(req.params.id) || !validRecord(table,req.body,true)) return res.status(400).json({error:'Invalid ID or fields'});
    const keys=Object.keys(req.body);
    const result=db.prepare(`UPDATE ${table} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k=>req.body[k]),req.params.id);
    if (!result.changes) return res.status(404).json({error:'Record not found'});
    res.json([db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id)]);
  });
  app.delete(route+'/:id',(req,res)=>{
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({error:'Invalid ID'});
    const result=db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
    if (!result.changes) return res.status(404).json({error:'Record not found'});
    res.json({ok:true});
  });
}
app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found'}));
// Explicit public assets only: never expose databases, exports, source configuration or backups.
for (const dir of ['js','css','img']) app.use('/'+dir,express.static(path.join(__dirname,'..',dir),{dotfiles:'deny',index:false}));
app.get(['/', '/index.html'],(req,res)=>res.sendFile(path.join(__dirname,'..','index.html')));
app.use((req,res)=>res.status(404).json({error:'Not found'}));
app.use((err,req,res,next)=>{
  console.error('API error:',err);
  if (res.headersSent) return next(err);
  const conflict=String(err.code||'').startsWith('SQLITE_CONSTRAINT');
  const status=conflict?409:(err.status || 500);
  res.status(status).json({error:conflict?'Record conflicts with existing data or relationships':status===500?'Database or server error':err.message});
});
if (require.main===module) app.listen(PORT,HOST,()=>console.log(`Server: http://${HOST}:${PORT}`));
module.exports={app,clients};
