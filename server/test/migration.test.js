const {test,after,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {execFileSync,spawnSync}=require('child_process');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'settlement-test-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.AUTH_USER='test-user';process.env.AUTH_PASSWORD='test-password';
process.env.CORS_ORIGINS='http://localhost:3001';
const auth='Basic '+Buffer.from('test-user:test-password').toString('base64');
let server,base,store,clients;
before(async()=>{
 execFileSync(process.execPath,['server/import-csv.js'],{cwd:root,env:process.env});
 store=require('../db');
 const api=require('../index');clients=api.clients;
 server=api.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{
 for(const c of clients||[]) c.end();
 if(server) {server.closeAllConnections();await new Promise(r=>server.close(r));}
 store?.db.close();
 fs.rmSync(dir,{recursive:true,force:true});
});
async function request(route,method='GET',body,headers={}){
 return fetch(base+route,{method,headers:{Authorization:auth,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
}
test('import counts, IDs, relationships, Arabic data and safe repeated import',()=>{
 const expected={car_makes:108,car_models:374,colors:34,registration_types:8,parts:391,sessions:331};
 for(const [table,n] of Object.entries(expected)) assert.equal(store.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,n);
 assert.equal(store.db.pragma('integrity_check',{simple:true}),'ok');
 assert.deepEqual(store.db.pragma('foreign_key_check'),[]);
 assert.match(store.db.prepare('SELECT color_name FROM colors WHERE id=1').get().color_name,/[\u0600-\u06ff]/);
 store.db.prepare('UPDATE parts SET default_price=123 WHERE id=(SELECT min(id) FROM parts)').run();
 execFileSync(process.execPath,['server/import-csv.js'],{cwd:root,env:process.env});
 assert.equal(store.db.prepare('SELECT default_price FROM parts ORDER BY id LIMIT 1').get().default_price,123);
 for(const [table,n] of Object.entries(expected)) assert.equal(store.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,n);
 assert.ok(fs.readdirSync(dir).some(f=>f.includes('.backup-')));
});
test('malformed CSV headers fail clearly without modifying the database',()=>{
 const bad=path.join(dir,'bad');fs.mkdirSync(bad);fs.writeFileSync(path.join(bad,'car_makes.csv'),'wrong,name\n1,test\n');
 const result=spawnSync(process.execPath,['server/import-csv.js',bad],{cwd:root,env:process.env,encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/missing required column id/);
 assert.equal(store.db.prepare('SELECT count(*) n FROM car_makes').get().n,108);
});
test('invalid foreign keys roll back every table in the import',()=>{
 const bad=path.join(dir,'orphan');fs.mkdirSync(bad);
 fs.cpSync(path.join(root,'Bashar Data base'),bad,{recursive:true});
 fs.appendFileSync(path.join(bad,'car_makes_rows.csv'),'999999,ROLLBACK MAKE\r\n');
 fs.appendFileSync(path.join(bad,'car_models_rows.csv'),'999999,888888,ORPHAN MODEL\r\n');
 const result=spawnSync(process.execPath,['server/import-csv.js',bad],{cwd:root,env:process.env,encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/FOREIGN KEY/);
 assert.equal(store.db.prepare('SELECT 1 FROM car_makes WHERE id=999999').get(),undefined);
});
test('health, authentication, restricted origins and private file protection',async()=>{
 assert.deepEqual(await (await fetch(base+'/api/health')).json(),{ok:true,database:'sqlite'});
 assert.equal((await fetch(base+'/api/colors')).status,401);
 assert.equal((await request('/api/colors','GET',undefined,{Origin:'https://untrusted.invalid'})).status,403);
 const good=await request('/api/colors','GET',undefined,{Origin:'http://localhost:3001'});
 assert.equal(good.headers.get('access-control-allow-origin'),'http://localhost:3001');
 assert.equal(good.headers.get('access-control-allow-credentials'),'true');
 for(const route of ['/server/settlement.db','/.env','/Bashar%20Data%20base/sessions_rows.csv','/package.json']) assert.equal((await fetch(base+route)).status,404);
 assert.equal((await fetch(base+'/')).status,200);
});
test('lookup reads and CRUD preserve the existing response shapes',async()=>{
 for(const table of ['car_makes','car_models','colors','registration_types','parts']) assert.ok((await (await request('/api/'+table)).json()).length);
 for(const [table,data,update] of [
   ['car_makes',{make_name:'TEST MAKE'},{make_name:'UPDATED MAKE'}],
   ['car_models',{make_id:1,model_name:'TEST MODEL'},{model_name:'UPDATED MODEL'}],
   ['colors',{color_name:'TEST COLOR'},{color_name:'UPDATED COLOR'}],
   ['registration_types',{type_name:'TEST TYPE'},{type_name:'UPDATED TYPE'}],
   ['parts',{part_name:'TEST PART',default_price:20},{default_price:30}]
 ]) {
   const created=await request('/api/'+table,'POST',data);assert.equal(created.status,201);
   const [row]=await created.json();assert.ok(row.id);
   const duplicate=await request('/api/'+table,'POST',data);assert.equal((await duplicate.json())[0].id,row.id);
   const changed=await request('/api/'+table+'/'+row.id,'PUT',update);assert.equal(changed.status,200);
   for(const [key,value] of Object.entries(update)) assert.equal((await changed.clone().json())[0][key],value);
   assert.equal((await request('/api/'+table+'/'+row.id,'DELETE')).status,200);
   assert.equal((await request('/api/'+table+'/'+row.id,'DELETE')).status,404);
 }
 assert.equal((await request('/api/car_models','POST',{make_id:9999999,model_name:'orphan'})).status,409);
 assert.equal((await request('/api/car_makes/1','DELETE')).status,409);
 assert.equal((await request('/api/colors','POST',{wrong:'field'})).status,400);
});
test('session round trip and SSE upsert/delete events',async()=>{
 const abort=new AbortController();
 const stream=await fetch(base+'/api/sessions/stream',{headers:{Authorization:auth},signal:abort.signal});
 const reader=stream.body.getReader();await reader.read();
 const session={caseNum:'TEST/SESSION',title:'test',state:{fields:{name:'test'},parts:[]},updatedAt:new Date().toISOString()};
 assert.equal((await request('/api/sessions/upsert','POST',session)).status,201);
 const event=new TextDecoder().decode((await reader.read()).value);assert.match(event,/event: upsert/);assert.match(event,/TEST\/SESSION/);
 const all=await (await request('/api/sessions')).json();assert.deepEqual(all[session.caseNum].state,session.state);
 session.title='edited';assert.equal((await request('/api/sessions/upsert','POST',session)).status,200);await reader.read();
 assert.equal((await request('/api/sessions/delete','POST',{caseNum:session.caseNum})).status,200);
 assert.match(new TextDecoder().decode((await reader.read()).value),/event: delete/);
 assert.equal((await (await request('/api/sessions')).json())[session.caseNum],undefined);
 abort.abort();
 assert.equal((await request('/api/sessions/upsert','POST',{caseNum:'invalid',state:'not an object'})).status,400);
});
test('frontend loads real lookup data and writes through Express in a DOM harness',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost:3001',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;const requests=[];const pending=new Set();
 w.APP_CONFIG={API_BASE_URL:base};w.confirm=()=>true;w.alert=()=>{};
 w.EventSource=class{constructor(url){requests.push(url);}addEventListener(){}close(){}};
 w.fetch=(url,options)=>{
   requests.push(url);
   const p=fetch(url,{...options,headers:{...options?.headers,Authorization:auth}});
   pending.add(p);p.finally(()=>pending.delete(p));return p;
 };
 try {
   w.eval(fs.readFileSync(path.join(root,'js/sett.js'),'utf8'));
   await new Promise(r=>setTimeout(r,300));await Promise.all([...pending]);
   assert.ok(w.document.querySelectorAll('#list-makes option').length>=108);
   await w.checkNewMake('DOM TEST MAKE');
   w.document.getElementById('f-vtype').value='DOM TEST MAKE';
   await w.checkNewModel('DOM TEST MODEL');
   await w.checkNewColor('DOM TEST COLOR');
   await w.checkNewPart('DOM TEST PART');
   const make=store.db.prepare('SELECT * FROM car_makes WHERE make_name=?').get('DOM TEST MAKE');assert.ok(make);
   assert.equal(store.db.prepare('SELECT make_id FROM car_models WHERE model_name=?').get('DOM TEST MODEL').make_id,make.id);
   assert.ok(store.db.prepare('SELECT 1 FROM colors WHERE color_name=?').get('DOM TEST COLOR'));
   assert.ok(store.db.prepare('SELECT 1 FROM parts WHERE part_name=?').get('DOM TEST PART'));
   await w.upsertSessionToServer('DOM SESSION',{title:'DOM',state:{fields:{}},updatedAt:new Date().toISOString()});
   assert.ok((await w.fetchSessionsFromServer())['DOM SESSION']);
   await w.removeSessionFromServer('DOM SESSION');
   assert.ok(requests.length>10);assert.ok(requests.every(url=>url.startsWith(base+'/api/')));
   const originalFetch=w.fetch;
   w.fetch=async()=>new Response(JSON.stringify({error:'Test failure'}),{status:500,headers:{'Content-Type':'application/json'}});
   await assert.rejects(w.upsertSessionToServer('FAILED SESSION',{state:{}}),/Test failure/);
   assert.equal(w.document.getElementById('sync-status').className,'sync-error');
   assert.equal(await w.insertToDB('colors',{color_name:'FAILED COLOR'}),false);
   assert.equal(store.db.prepare('SELECT 1 FROM colors WHERE color_name=?').get('FAILED COLOR'),undefined);
   w.fetch=originalFetch;
 } finally {w.close();}
});
