import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testData=fs.mkdtempSync(path.join(root,'tests','run-'));
let child,base,doctorCookie,patientCookie;
async function start(){
 child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,PORT:'0',MEDSENSE_DATA_DIR:testData},stdio:['ignore','pipe','pipe']});
 let log='';child.stderr.on('data',x=>{log+=x;});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Server timeout: '+log)),15000);
  child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exit '+code+': '+log));});
  child.stdout.on('data',x=>{const m=String(x).match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){base=`http://127.0.0.1:${m[1]}`;clearTimeout(timer);resolve();}});
 });
}
async function stop(){if(child&&child.exitCode===null){child.kill();await once(child,'exit');}}
async function req(url,{method='GET',cookie,body,origin}={}){
 const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
 const type=res.headers.get('content-type')||'';
 return {status:res.status,body:type.includes('json')?await res.json():await res.text(),headers:res.headers};
}
async function login(email,password){const r=await req('/api/login',{method:'POST',body:{email,password}});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
const reading=(extra={})=>({systolic:125,diastolic:82,pulse:72,measured_at:new Date().toISOString(),note:'Integration test',...extra});
before(async()=>{await start();doctorCookie=await login('doctor@medsense.local','Doctor2026!');patientCookie=await login('patient1@medsense.local','Patient2026!');});
after(async()=>{await stop();console.log('Isolated test database: '+testData);});

test('authentication, role boundaries, origin and static file protection',async()=>{
 assert.equal((await req('/api/dashboard')).status,401);
 assert.equal((await req('/api/login',{method:'POST',body:{email:'doctor@medsense.local',password:'wrong'}})).status,401);
 assert.equal((await req('/api/settings',{method:'PUT',cookie:patientCookie,body:{systolic:160,diastolic:100,missed_hours:48}})).status,403);
 assert.equal((await req('/api/readings',{method:'POST',cookie:doctorCookie,body:reading()})).status,403);
 assert.equal((await req('/api/readings',{method:'POST',cookie:patientCookie,origin:'https://untrusted.test',body:reading()})).status,403);
 assert.equal((await req('/server.mjs')).status,404);
 assert.equal((await req('/data/medsense.sqlite')).status,404);
 assert.equal((await req('/')).status,200);
 assert.equal((await req('/api/push/key')).status,401);
 assert.equal((await req('/api/push/key',{cookie:patientCookie})).status,403);
 const pushKey=await req('/api/push/key',{cookie:doctorCookie});assert.equal(pushKey.status,200);assert.equal(Buffer.from(pushKey.body.publicKey,'base64url').length,65);
 assert.equal((await req('/api/push/subscribe',{method:'POST',cookie:doctorCookie,body:{subscription:{endpoint:'https://127.0.0.1/internal'}}})).status,400);
 assert.equal((await req('/api/push/test',{method:'POST',cookie:patientCookie,body:{}})).status,403);
 const pushTest=await req('/api/push/test',{method:'POST',cookie:doctorCookie,body:{}});assert.equal(pushTest.status,200);assert.deepEqual(pushTest.body,{devices:0,accepted:0});
 assert.equal((await req('/sw.js')).status,200);
 assert.equal((await req('/manifest.webmanifest')).body.display,'standalone');
});

test('seeded records show repeated and missing flags, with four synthetic patients',async()=>{
 const r=await req('/api/dashboard',{cookie:doctorCookie});assert.equal(r.status,200);
 assert.equal(r.body.patients.length,4);
 assert.ok(r.body.patients.every(x=>x.patient.synthetic));
 assert.ok(r.body.patients.find(x=>x.patient.code==='P001').flags.includes('repeated'));
 assert.ok(r.body.patients.find(x=>x.patient.code==='P002').flags.includes('missing'));
 assert.equal(r.body.patients.find(x=>x.patient.code==='P004').needsReview,false);
});

test('patient cannot access another patient or review a record',async()=>{
 const all=(await req('/api/dashboard',{cookie:doctorCookie})).body.patients;
 const other=all.find(x=>x.patient.code==='P002').patient.id;
 assert.equal((await req(`/api/patients/${other}`,{cookie:patientCookie})).status,404);
 assert.equal((await req(`/api/patients/${other}/export`,{cookie:patientCookie})).status,404);
 const me=(await req('/api/dashboard',{cookie:patientCookie})).body.patient.id;
 assert.equal((await req(`/api/patients/${me}/review`,{method:'POST',cookie:patientCookie,body:{comment:'test',last_reading_id:0}})).status,403);
});

test('measurement validation rejects invalid pressure, pulse and future timestamps',async()=>{
 for(const extra of [{systolic:60,diastolic:90},{systolic:125.5},{pulse:0},{diastolic:20},{measured_at:new Date(Date.now()+3600000).toISOString()},{note:'x'.repeat(501)}]){
  const r=await req('/api/readings',{method:'POST',cookie:patientCookie,body:reading(extra)});assert.equal(r.status,400,JSON.stringify(extra));
 }
});

let savedId;
test('local assistant enforces authentication and existing patient ownership',async()=>{
 const body={topic:'summary',language:'en',warningSymptoms:false,specialPopulation:false};
 assert.equal((await req('/api/assistant',{method:'POST',body})).status,401);
 const d=(await req('/api/dashboard',{cookie:patientCookie})).body;
 const result=await req('/api/assistant',{method:'POST',cookie:patientCookie,body});assert.equal(result.status,200);assert.equal(result.body.mode,'local-rules');assert.equal(result.body.snapshot.count14,d.count14);
 assert.equal((await req('/api/assistant',{method:'POST',cookie:patientCookie,body:{...body,patientId:d.patient.id+1}})).status,404);
 assert.equal((await req('/api/assistant',{method:'POST',cookie:doctorCookie,body:{...body,patientId:d.patient.id}})).status,200);
 assert.equal((await req('/api/assistant',{method:'POST',cookie:doctorCookie,body:{...body,patientId:999999}})).status,404);
 assert.equal((await req('/api/assistant',{method:'POST',cookie:patientCookie,body:{...body,question:'x'.repeat(401)}})).status,400);
 assert.equal((await req('/assistant-service.mjs')).status,404);
 assert.equal((await req('/assistant.css')).status,200);
});
test('reading persists and appears to the assigned clinician; CSV escapes formula injection',async()=>{
 const r=await req('/api/readings',{method:'POST',cookie:patientCookie,body:reading({note:'=HYPERLINK("test")'})});assert.equal(r.status,201);savedId=r.body.id;
 const d=(await req('/api/dashboard',{cookie:patientCookie})).body;
 assert.ok(d.readings.find(x=>x.id===savedId));
 const clinician=(await req(`/api/patients/${d.patient.id}`,{cookie:doctorCookie})).body;
 assert.ok(clinician.readings.find(x=>x.id===savedId));
 const csv=await req(`/api/patients/${d.patient.id}/export`,{cookie:doctorCookie});
 assert.equal(csv.status,200);assert.match(csv.body,/'=HYPERLINK/);assert.match(csv.body,/systolic/);
});

test('review snapshot prevents unseen entries; new reading reopens patient queue',async()=>{
 let d=(await req('/api/dashboard',{cookie:patientCookie})).body;const id=d.patient.id;
 let r=await req(`/api/patients/${id}/review`,{method:'POST',cookie:doctorCookie,body:{comment:'Reviewed in test',last_reading_id:0}});assert.equal(r.status,409);
 const max=Math.max(...d.readings.map(x=>x.id));
 r=await req(`/api/patients/${id}/review`,{method:'POST',cookie:doctorCookie,body:{comment:'Reviewed in test',last_reading_id:max}});assert.equal(r.status,201);
 d=(await req('/api/dashboard',{cookie:patientCookie})).body;assert.equal(d.needsReview,false);assert.equal(d.reviews[0].comment,'Reviewed in test');
 assert.equal((await req('/api/readings',{method:'POST',cookie:patientCookie,body:reading()})).status,201);
 d=(await req('/api/dashboard',{cookie:patientCookie})).body;assert.equal(d.needsReview,true);
});

test('clinician can enroll a participant with consent, isolated history and usable login',async()=>{
 const body={name:'Test participant',email:'participant@example.test',password:'Participant2026!',consent:true};
 assert.equal((await req('/api/patients',{method:'POST',cookie:doctorCookie,body:{...body,consent:false}})).status,400);
 const r=await req('/api/patients',{method:'POST',cookie:doctorCookie,body});assert.equal(r.status,201);
 assert.equal((await req('/api/patients',{method:'POST',cookie:doctorCookie,body})).status,409);
 const cookie=await login(body.email,body.password);
 const d=(await req('/api/dashboard',{cookie})).body;assert.equal(d.patient.synthetic,false);assert.equal(d.readings.length,0);assert.deepEqual(d.flags,[]);
 assert.equal((await req('/api/readings',{method:'POST',cookie,body:reading()})).status,201);
 const metrics=(await req('/api/metrics',{cookie:doctorCookie})).body;
 assert.equal(metrics.participants,1);assert.equal(metrics.activePatients,2);
 assert.equal(metrics.counts.find(x=>x.event==='reading_added').count,3);
 assert.equal((await req('/api/metrics',{cookie})).status,403);
});

test('a second clinician cannot access this clinic, including exports',async()=>{
 const fixture=new DatabaseSync(path.join(testData,'medsense.sqlite'));
 const hash=fixture.prepare('SELECT password FROM users WHERE role=?').get('doctor').password;
 const id=Number(fixture.prepare('INSERT INTO users(email,password,role,name,code,synthetic,created_at) VALUES(?,?,?,?,?,?,?)').run('other@example.test',hash,'doctor','Other doctor','D002',1,new Date().toISOString()).lastInsertRowid);
 fixture.prepare('INSERT INTO settings(doctor_id) VALUES(?)').run(id);fixture.close();
 const other=await login('other@example.test','Doctor2026!');
 const id1=(await req('/api/dashboard',{cookie:patientCookie})).body.patient.id;
 assert.equal((await req(`/api/patients/${id1}`,{cookie:other})).status,404);
 assert.equal((await req(`/api/patients/${id1}/export`,{cookie:other})).status,404);
 assert.equal((await req('/api/assistant',{method:'POST',cookie:other,body:{topic:'latest',language:'en',patientId:id1,warningSymptoms:false,specialPopulation:false}})).status,404);
 assert.equal((await req('/api/dashboard',{cookie:other})).body.patients.length,0);
});

test('settings recalculate flags and reject out-of-range rules',async()=>{
 assert.equal((await req('/api/settings',{method:'PUT',cookie:doctorCookie,body:{systolic:220,diastolic:140,missed_hours:168}})).status,200);
 const all=(await req('/api/dashboard',{cookie:doctorCookie})).body.patients;
 assert.ok(!all.find(x=>x.patient.code==='P001').flags.includes('repeated'));
 assert.ok(!all.find(x=>x.patient.code==='P002').flags.includes('missing'));
 assert.equal((await req('/api/settings',{method:'PUT',cookie:doctorCookie,body:{systolic:999,diastolic:100,missed_hours:48}})).status,400);
});

test('database and session survive server restart; logout invalidates session',async()=>{
 await stop();await start();
 const d=await req('/api/dashboard',{cookie:patientCookie});assert.equal(d.status,200);assert.ok(d.body.readings.find(x=>x.id===savedId));
 assert.equal((await req('/api/logout',{method:'POST',cookie:patientCookie,body:{}})).status,200);
 assert.equal((await req('/api/dashboard',{cookie:patientCookie})).status,401);
});
