import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=fs.mkdtempSync(path.join(root,'tests','run-public-'));
const origin='https://beta.example.test';
const accounts=[{email:'clinician@example.test',password:randomBytes(18).toString('hex'),role:'doctor',name:'Test clinician',code:'BTD'},
 {email:'participant@example.test',password:randomBytes(18).toString('hex'),role:'patient',name:'Test participant',code:'BTP',synthetic:false}];
fs.writeFileSync(path.join(dir,'accounts.json'),JSON.stringify({accounts}));
let child,base;
before(async()=>{
 child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,PORT:'0',MEDSENSE_PUBLIC:'1',MEDSENSE_DATA_DIR:path.join(dir,'db'),MEDSENSE_BOOTSTRAP_PATH:path.join(dir,'accounts.json'),MEDSENSE_PUBLIC_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error('Startup timeout: '+log)),15000);child.stderr.on('data',x=>log+=x);child.on('exit',code=>{clearTimeout(timer);reject(new Error('Startup failed '+code+': '+log));});child.stdout.on('data',x=>{const m=String(x).match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){base=`http://127.0.0.1:${m[1]}`;clearTimeout(timer);resolve();}});});
});
after(async()=>{if(child?.exitCode===null){child.kill();await once(child,'exit');}});
async function request(url,{method='GET',body,cookie,requestOrigin=origin,host='beta.example.test'}={}){
 return new Promise((resolve,reject)=>{
  const raw=body?JSON.stringify(body):null;
  const r=http.request(base+url,{method,headers:{Host:host,'Content-Type':'application/json',Origin:requestOrigin,...(raw?{'Content-Length':Buffer.byteLength(raw)}:{}),...(cookie?{cookie}:{})}},res=>{
   let data='';res.on('data',x=>data+=x);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(data),headers:{get:key=>Array.isArray(res.headers[key])?res.headers[key][0]:res.headers[key]}});}catch(err){reject(err);}});
  });r.on('error',reject);if(raw)r.write(raw);r.end();
 });
}
test('public config contains no demo accounts or credentials',async()=>{
 const r=await request('/api/config');assert.equal(r.status,200);assert.equal(r.body.demoEnabled,false);assert.equal(r.body.publicMode,true);assert.deepEqual(r.body.demoAccounts,{});
});
test('public mode restricts Host and Origin',async()=>{
 assert.equal((await request('/api/config',{host:'wrong.example.test'})).status,503);
 assert.equal((await request('/api/login',{method:'POST',body:{email:accounts[0].email,password:accounts[0].password},requestOrigin:'https://untrusted.example'})).status,403);
});
test('known local demo credentials cannot authenticate remotely',async()=>{
 assert.equal((await request('/api/login',{method:'POST',body:{email:'doctor@medsense.local',password:'Doctor2026!'}})).status,401);
});
test('individual login uses Secure cookies and starts with separate empty records',async()=>{
 const login=await request('/api/login',{method:'POST',body:{email:accounts[0].email,password:accounts[0].password}});
 assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/; Secure/);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const dashboard=await request('/api/dashboard',{cookie});assert.equal(dashboard.body.patients.length,1);assert.equal(dashboard.body.patients[0].readings.length,0);
 const patientLogin=await request('/api/login',{method:'POST',body:{email:accounts[1].email,password:accounts[1].password}});
 const pCookie=patientLogin.headers.get('set-cookie').split(';')[0];
 const save=await request('/api/readings',{method:'POST',cookie:pCookie,body:{systolic:128,diastolic:82,pulse:72,measured_at:new Date().toISOString(),note:'Fictional public-mode test'}});assert.equal(save.status,201);
 const updated=await request('/api/dashboard',{cookie});assert.equal(updated.body.patients[0].readings[0].id,save.body.id);
 assert.equal((await request('/api/metrics',{cookie:pCookie})).status,403);
});
