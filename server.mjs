import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createPushService } from './push-service.mjs';
import { buildGuidance } from './assistant-service.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_MODE = process.env.MEDSENSE_PUBLIC === '1';
if (PUBLIC_MODE && !process.env.MEDSENSE_DATA_DIR) throw new Error('Public testing requires a separate data directory');
const DATA = process.env.MEDSENSE_DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'medsense.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('doctor','patient')), name TEXT NOT NULL,
 code TEXT UNIQUE, doctor_id INTEGER REFERENCES users(id), synthetic INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS readings (
 id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES users(id),
 systolic INTEGER NOT NULL, diastolic INTEGER NOT NULL, pulse INTEGER NOT NULL,
 measured_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual',
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
 id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES users(id),
 doctor_id INTEGER NOT NULL REFERENCES users(id), comment TEXT NOT NULL DEFAULT '',
 last_reading_id INTEGER NOT NULL DEFAULT 0, reviewed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
 doctor_id INTEGER PRIMARY KEY REFERENCES users(id), systolic INTEGER NOT NULL DEFAULT 160,
 diastolic INTEGER NOT NULL DEFAULT 100, missed_hours INTEGER NOT NULL DEFAULT 48
);
CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), event TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);`);

const now = () => new Date().toISOString();
const hash = (pw) => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`; };
function verify(pw, stored) {
 const [salt, key] = stored.split(':');
 const candidate = scryptSync(pw, salt, 32);
 return timingSafeEqual(candidate, Buffer.from(key, 'hex'));
}
function event(user, type, detail = '') {
 db.prepare('INSERT INTO events(user_id,event,detail,created_at) VALUES(?,?,?,?)').run(user.id, type, detail, now());
}
function publicUser(u) {
 return { id:u.id, name:u.name, role:u.role, email:u.email, code:u.code, synthetic:!!u.synthetic };
}
function seed() {
 if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return;
 const created = now();
 const add = db.prepare('INSERT INTO users(email,password,role,name,code,doctor_id,synthetic,created_at) VALUES(?,?,?,?,?,?,?,?)');
 if (PUBLIC_MODE) {
  if (!process.env.MEDSENSE_BOOTSTRAP_PATH) throw new Error('Public account configuration required');
  const accounts = JSON.parse(fs.readFileSync(process.env.MEDSENSE_BOOTSTRAP_PATH,'utf8')).accounts;
  if (!Array.isArray(accounts) || !accounts.length || accounts.some(a=>typeof a.password!=='string'||a.password.length<16)) throw new Error('Invalid public account configuration');
  db.exec('BEGIN');
  try {
   const clinician=accounts.find(a=>a.role==='doctor');
   if (!clinician) throw new Error('Clinician account required');
   const doctors=new Map();
   for(const a of accounts.filter(a=>a.role==='doctor')) {
    const id=Number(add.run(a.email,hash(a.password),'doctor',a.name,a.code,null,a.synthetic?1:0,created).lastInsertRowid);
    doctors.set(a.code,id);
    db.prepare('INSERT INTO settings(doctor_id) VALUES(?)').run(id);
   }
   for(const a of accounts.filter(a=>a.role==='patient')) {
    const doctor=doctors.get(a.doctorCode||clinician.code);
    if(!doctor) throw new Error('Unknown clinician assignment');
    add.run(a.email,hash(a.password),'patient',a.name,a.code,doctor,a.synthetic?1:0,created);
   }
   db.exec('COMMIT');
  } catch(err) { db.exec('ROLLBACK');throw err; }
  return;
 }
 const doctor = Number(add.run('doctor@medsense.local', hash('Doctor2026!'), 'doctor', 'Демо-врач', 'D001', null, 1, created).lastInsertRowid);
 db.prepare('INSERT INTO settings(doctor_id) VALUES(?)').run(doctor);
 const names = ['Пациент 001','Пациент 002','Пациент 003','Пациент 004'];
 names.forEach((name, idx) => {
  const id = Number(add.run(`patient${idx+1}@medsense.local`, hash('Patient2026!'), 'patient', name, `P00${idx+1}`, doctor, 1, created).lastInsertRowid);
  const insert = db.prepare('INSERT INTO readings(patient_id,systolic,diastolic,pulse,measured_at,note,source,created_at) VALUES(?,?,?,?,?,?,?,?)');
  for (let day = 13; day >= (idx === 1 ? 3 : 0); day--) {
   for (const hour of [8,20]) {
    const d = new Date(); d.setDate(d.getDate()-day); d.setHours(hour,0,0,0);
    if (d.getTime() > Date.now()) continue;
    const attention = idx === 0 && day <= 1;
    const systolic = attention ? 164 + (day%2)*3 : 122 + idx*5 + ((day*7+hour)%15);
    const diastolic = attention ? 101 + day : 76 + ((day+idx*2)%10);
    insert.run(id,systolic,diastolic,65+((day*3+idx)%17),d.toISOString(),'','demo',created);
   }
  }
  if (idx === 3) {
   const latest = db.prepare('SELECT MAX(id) id FROM readings WHERE patient_id=?').get(id).id;
   db.prepare('INSERT INTO reviews(patient_id,doctor_id,comment,last_reading_id,reviewed_at) VALUES(?,?,?,?,?)')
    .run(id,doctor,'Демонстрационная отметка просмотра.',latest,created);
  }
 });
}
seed();
const push=createPushService(db,DATA,()=>PUBLIC_MODE?publicOrigin():`http://localhost:${process.env.PORT||4173}`);

function settings(doctorId) { return db.prepare('SELECT systolic,diastolic,missed_hours FROM settings WHERE doctor_id=?').get(doctorId); }
function patientData(patient) {
 const readings = db.prepare('SELECT * FROM readings WHERE patient_id=? ORDER BY measured_at DESC,id DESC').all(patient.id);
 const reviews = db.prepare('SELECT r.*,u.name doctor_name FROM reviews r JOIN users u ON u.id=r.doctor_id WHERE patient_id=? ORDER BY r.id DESC').all(patient.id);
 const rules = settings(patient.doctor_id);
 const latest = readings[0] || null;
 const since = latest ? (Date.now()-Date.parse(latest.measured_at))/3600000 : (Date.now()-Date.parse(patient.created_at))/3600000;
 const recent = readings.filter(r=>Date.parse(r.measured_at)>Date.now()-72*3600000);
 const repeated = recent.length>=2 && recent.slice(0,2).every(r=>r.systolic>=rules.systolic || r.diastolic>=rules.diastolic);
 const missing = since >= rules.missed_hours;
 const review = reviews[0] || null;
 const maxId = readings.reduce((m,r)=>Math.max(m,r.id),0);
 const hasNew = !review || maxId>review.last_reading_id;
 // A newly elapsed missing-data window requires attention even after an earlier review.
 const needsReview = hasNew || (missing && Date.now()-Date.parse(review?.reviewed_at || 0)>=rules.missed_hours*3600000);
 const flags = [];
 if (repeated) flags.push('repeated');
 if (missing) flags.push('missing');
 const recent14=readings.filter(r=>Date.parse(r.measured_at)>=Date.now()-14*86400000);
 const average=recent14.length ? {
  systolic:Math.round(recent14.reduce((s,r)=>s+r.systolic,0)/recent14.length),
  diastolic:Math.round(recent14.reduce((s,r)=>s+r.diastolic,0)/recent14.length)
 } : null;
 return { patient:publicUser(patient), readings, reviews, latest, flags, needsReview,
  reviewStatus:review && !needsReview ? 'reviewed':'new', average, rules,
  count14:recent14.length, days14:new Set(recent14.map(r=>r.measured_at.slice(0,10))).size };
}
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
const attemptMap = new Map();
const ipAttempts = new Map();
const assistantRequests = new Map();
function publicOrigin() {
 if (process.env.MEDSENSE_PUBLIC_ORIGIN) return process.env.MEDSENSE_PUBLIC_ORIGIN;
 try { return JSON.parse(fs.readFileSync(process.env.MEDSENSE_PUBLIC_ORIGIN_FILE,'utf8')).origin; } catch { return null; }
}
function readJson(req) {
 return new Promise((resolve,reject)=>{
  let raw='';
  req.on('data',chunk=>{raw+=chunk;if(raw.length>65536){reject(Object.assign(new Error('Request too large'),{status:413}));req.destroy();}});
  req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch{reject(Object.assign(new Error('Invalid JSON'),{status:400}));}});
  req.on('error',reject);
 });
}
function authenticate(req) {
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('medsense_session='))?.split('=')[1];
 if (!token) return null;
 return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?').get(token,Date.now()) || null;
}
function csvEscape(v) { const s=String(v??'');return '"'+(/^[=+@\-\t\r]/.test(s)?"'":'')+s.replaceAll('"','""')+'"'; }
const server=http.createServer(async(req,res)=>{
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
 const url = new URL(req.url,'http://localhost');
 try {
  if (!url.pathname.startsWith('/api/')) {
   const paths={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/ios.css':'ios.css','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png'};
   paths['/assistant.css']='assistant.css';
   paths['/kk.js']='kk.js';
   const file=paths[url.pathname];
   if (!file || req.method!=='GET') return send(404,{error:'Not found'});
   const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webmanifest')?'application/manifest+json':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'text/html';
   res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-cache'});
   return res.end(fs.readFileSync(path.join(ROOT,'public',file)));
  }
  res.setHeader('Cache-Control','no-store');
  const allowedOrigin=PUBLIC_MODE?publicOrigin():`http://${req.headers.host}`;
  if(PUBLIC_MODE && (!allowedOrigin || req.headers.host!==new URL(allowedOrigin).host)) fail(503,'Beta connection is not ready');
  if (!['GET','HEAD'].includes(req.method)) {
   const origin=req.headers.origin;
   if ((PUBLIC_MODE && origin!==allowedOrigin) || (origin && origin!==allowedOrigin)) fail(403,'Origin not allowed');
   if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'JSON required');
  }
  if(url.pathname==='/api/config' && req.method==='GET') return send(200,{
   publicMode:PUBLIC_MODE,demoEnabled:!PUBLIC_MODE,
   demoAccounts:PUBLIC_MODE?{}:{doctor:{email:'doctor@medsense.local',password:'Doctor2026!'},patient:{email:'patient1@medsense.local',password:'Patient2026!'}}
  });
  if (url.pathname==='/api/login' && req.method==='POST') {
   if(PUBLIC_MODE) {
    const ip=req.headers['cf-connecting-ip']||req.socket.remoteAddress;
    const attempt=ipAttempts.get(ip);
    if(attempt?.until>Date.now() && attempt.count>=40)fail(429,'Too many attempts. Try again in 5 minutes.');
    if(ipAttempts.size>10000)for(const [key,v] of ipAttempts)if(v.until<Date.now())ipAttempts.delete(key);
    ipAttempts.set(ip,{count:attempt?.until>Date.now()?attempt.count+1:1,until:Date.now()+300000});
   }
   const body=await readJson(req);
   if (typeof body.email!=='string'||typeof body.password!=='string'||body.password.length>128) fail(400,'Invalid credentials');
   const key=body.email.toLowerCase().trim();
   const attempt=attemptMap.get(key);
   if (attempt && attempt.until>Date.now() && attempt.count>=15) fail(429,'Too many attempts. Try again in 5 minutes.');
   const u=db.prepare('SELECT * FROM users WHERE email=?').get(key);
   if (!u || !verify(body.password,u.password)) {
    attemptMap.set(key,{count:attempt?.until>Date.now()?attempt.count+1:1,until:Date.now()+300000});
    fail(401,'Неверная почта или пароль / Invalid email or password');
   }
   attemptMap.delete(key);
   db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
   const token=randomBytes(32).toString('hex');
   db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,u.id,Date.now()+8*3600000);
   res.setHeader('Set-Cookie',`medsense_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${PUBLIC_MODE?'; Secure':''}`);
   event(u,'login');return send(200,publicUser(u));
  }
  const user=authenticate(req);
  if (!user) fail(401,'Please sign in');
  if (url.pathname==='/api/me' && req.method==='GET') return send(200,publicUser(user));
  if(url.pathname==='/api/assistant' && req.method==='POST'){
   const b=await readJson(req);
   if(!['ru','en','kk'].includes(b.language)||!['latest','summary','technique','doctor'].includes(b.topic)||
    (b.question!==undefined&&(typeof b.question!=='string'||b.question.length>400))||
    typeof b.warningSymptoms!=='boolean'||typeof b.specialPopulation!=='boolean')fail(400,'Invalid assistant request');
   let p=user;
   if(user.role==='doctor'){
    if(!Number.isSafeInteger(b.patientId))fail(400,'Select a patient');
    p=db.prepare("SELECT * FROM users WHERE id=? AND doctor_id=? AND role='patient'").get(b.patientId,user.id);
    if(!p)fail(404,'Patient not found');
   }else if(b.patientId!==undefined&&b.patientId!==user.id)fail(404,'Patient not found');
   const previous=assistantRequests.get(user.id),windowMs=60000;
   if(previous?.until>Date.now()&&previous.count>=25)fail(429,'Please wait a minute');
   if(assistantRequests.size>10000)for(const [id,v] of assistantRequests)if(v.until<Date.now())assistantRequests.delete(id);
   assistantRequests.set(user.id,{count:previous?.until>Date.now()?previous.count+1:1,until:Date.now()+windowMs});
   const result=buildGuidance(patientData(p),b);
   event(user,'assistant_opened',result.topic);return send(200,result);
  }
  if(url.pathname.startsWith('/api/push/')){
   if(user.role!=='doctor')fail(403,'Clinicians only');
   if(url.pathname==='/api/push/key'&&req.method==='GET')return send(200,{publicKey:push.publicKey});
   if(url.pathname==='/api/push/subscribe'&&req.method==='POST'){
    const body=await readJson(req);try{push.save(user,req,body.subscription,body.language);}catch(error){fail(400,error.message);}return send(200,{ok:true});
   }
   if(url.pathname==='/api/push/unsubscribe'&&req.method==='POST'){
    const body=await readJson(req);if(typeof body.endpoint!=='string')fail(400,'Invalid endpoint');push.remove(user.id,body.endpoint);return send(200,{ok:true});
   }
   if(url.pathname==='/api/push/test'&&req.method==='POST'){
    const result=await push.deliver(user.id,language=>({title:'MedSense',body:language==='kk'?'Сынақ хабарландыруы':'Тестовое уведомление / Test notification',tag:'medsense-test'}));return send(200,result);
   }
  }
  if (url.pathname==='/api/logout' && req.method==='POST') {
   push.logout(user,req);
   const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('medsense_session='))?.split('=')[1];
   if(token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
   res.setHeader('Set-Cookie',`medsense_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${PUBLIC_MODE?'; Secure':''}`);return send(200,{ok:true});
  }
  if (url.pathname==='/api/dashboard' && req.method==='GET') {
   if (user.role==='patient') return send(200,patientData(user));
   const patients=db.prepare('SELECT * FROM users WHERE doctor_id=?').all(user.id).map(patientData);
   patients.sort((a,b)=>(Number(b.needsReview)*10+b.flags.length)-(Number(a.needsReview)*10+a.flags.length));
   return send(200,{patients,rules:settings(user.id)});
  }
  if (url.pathname==='/api/readings' && req.method==='POST') {
   if (user.role!=='patient') fail(403,'Patients only');
   const b=await readJson(req);
   for(const [field,min,max] of [['systolic',60,260],['diastolic',30,180],['pulse',30,220]]) {
    if(!Number.isInteger(b[field])||b[field]<min||b[field]>max) fail(400,`Invalid ${field}: ${min}–${max}`);
   }
   if(b.systolic<=b.diastolic) fail(400,'Systolic must exceed diastolic');
   const timestamp=Date.parse(b.measured_at);
   if(!Number.isFinite(timestamp)||timestamp>Date.now()+60000||timestamp<Date.now()-365*86400000) fail(400,'Invalid measurement date');
   if(typeof b.note!=='string'||b.note.length>500) fail(400,'Note must be under 500 characters');
   const id=Number(db.prepare('INSERT INTO readings(patient_id,systolic,diastolic,pulse,measured_at,note,source,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(user.id,b.systolic,b.diastolic,b.pulse,new Date(timestamp).toISOString(),b.note.trim(),'manual',now()).lastInsertRowid);
   event(user,'reading_added',String(id));
   void push.notifyReading(user,{...b,id}).catch(()=>console.warn('Push delivery unavailable'));
   return send(201,{id});
  }
  if (url.pathname==='/api/patients' && req.method==='POST') {
   if(user.role!=='doctor') fail(403,'Clinicians only');
   const b=await readJson(req);
   if(typeof b.name!=='string'||b.name.trim().length<2||b.name.length>80) fail(400,'Name: 2–80 characters');
   if(typeof b.email!=='string'||!/^\S+@\S+\.\S+$/.test(b.email)||b.email.length>120) fail(400,'Invalid email');
   if(typeof b.password!=='string'||b.password.length<10||b.password.length>128) fail(400,'Password: 10–128 characters');
   if(b.consent!==true) fail(400,'Consent confirmation required');
   if(db.prepare('SELECT id FROM users WHERE email=?').get(b.email.toLowerCase().trim())) fail(409,'Email already exists');
   const code='P'+randomBytes(3).toString('hex').toUpperCase();
   const id=Number(db.prepare('INSERT INTO users(email,password,role,name,code,doctor_id,synthetic,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(b.email.toLowerCase().trim(),hash(b.password),'patient',b.name.trim(),code,user.id,0,now()).lastInsertRowid);
   event(user,'patient_created',code);return send(201,{id,code});
  }
  const match=url.pathname.match(/^\/api\/patients\/(\d+)(?:\/(review|export))?$/);
  if(match) {
   const id=Number(match[1]);
   const p=db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(id,'patient');
   if(!p || !(user.role==='doctor'&&p.doctor_id===user.id || user.role==='patient'&&p.id===user.id)) fail(404,'Patient not found');
   if(req.method==='GET'&&!match[2]) {if(user.role==='doctor')event(user,'patient_opened',p.code);return send(200,patientData(p));}
   if(req.method==='POST'&&match[2]==='review') {
    if(user.role!=='doctor')fail(403,'Clinicians only');
    const b=await readJson(req);
    if(typeof b.comment!=='string'||b.comment.length>1000)fail(400,'Comment: maximum 1000 characters');
    const latest=db.prepare('SELECT MAX(id) id FROM readings WHERE patient_id=?').get(p.id).id||0;
    // Snapshot ID prevents an unseen new reading from being silently marked as reviewed.
    if(b.last_reading_id!==latest)fail(409,'New readings available. Refresh before reviewing.');
    db.prepare('INSERT INTO reviews(patient_id,doctor_id,comment,last_reading_id,reviewed_at) VALUES(?,?,?,?,?)').run(p.id,user.id,b.comment.trim(),latest,now());
    event(user,'review_completed',p.code);return send(201,{ok:true});
   }
   if(req.method==='GET'&&match[2]==='export') {
    const data=patientData(p);
    const rows=[['patient_code','measured_at_utc','systolic','diastolic','pulse','note','source','synthetic'],
     ...data.readings.map(r=>[p.code,r.measured_at,r.systolic,r.diastolic,r.pulse,r.note,r.source,p.synthetic])];
    event(user,'csv_exported',p.code);
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="MedSense-${p.code}.csv"`});
    return res.end('\uFEFF'+rows.map(r=>r.map(csvEscape).join(',')).join('\r\n'));
   }
  }
  if(url.pathname==='/api/settings'&&req.method==='PUT') {
   if(user.role!=='doctor')fail(403,'Clinicians only');
   const b=await readJson(req);
   if(!Number.isInteger(b.systolic)||b.systolic<120||b.systolic>220 || !Number.isInteger(b.diastolic)||b.diastolic<70||b.diastolic>140 || !Number.isInteger(b.missed_hours)||b.missed_hours<12||b.missed_hours>168)fail(400,'Invalid rules');
   db.prepare('UPDATE settings SET systolic=?,diastolic=?,missed_hours=? WHERE doctor_id=?').run(b.systolic,b.diastolic,b.missed_hours,user.id);
   event(user,'rules_updated');return send(200,{ok:true});
  }
  if(url.pathname==='/api/metrics'&&req.method==='GET') {
   if(user.role!=='doctor')fail(403,'Clinicians only');
   const counts=db.prepare(`SELECT e.event,COUNT(*) count FROM events e JOIN users u ON u.id=e.user_id
    WHERE (u.id=? OR u.doctor_id=?) AND e.created_at>=? GROUP BY e.event`).all(user.id,user.id,new Date(Date.now()-14*86400000).toISOString());
   const patients=db.prepare('SELECT id,code,synthetic FROM users WHERE doctor_id=?').all(user.id);
   const active=db.prepare(`SELECT COUNT(DISTINCT r.patient_id) count FROM readings r JOIN users u ON r.patient_id=u.id
    WHERE u.doctor_id=? AND r.source='manual' AND r.created_at>=?`).get(user.id,new Date(Date.now()-14*86400000).toISOString()).count;
   return send(200,{counts,activePatients:active,participants:patients.filter(p=>!p.synthetic).length,syntheticPatients:patients.filter(p=>p.synthetic).length,
    events:db.prepare(`SELECT e.event,e.created_at,u.code,u.synthetic FROM events e JOIN users u ON u.id=e.user_id
     WHERE (u.id=? OR u.doctor_id=?) AND e.created_at>=? ORDER BY e.id DESC LIMIT 60`).all(user.id,user.id,new Date(Date.now()-14*86400000).toISOString())});
  }
  fail(404,'Not found');
 }catch(err){if(!res.headersSent){if(!err.status)console.error(err);send(err.status||500,{error:err.status?err.message:'Server error'});}}
});
const port=Number(process.env.PORT||4173);
server.listen(port,'127.0.0.1',()=>console.log(`MedSense running at http://127.0.0.1:${server.address().port}\nData: ${DATA}`));
function shutdown(){server.close(()=>{db.close();process.exit(0);});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
