import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const state=path.join(root,'.local-beta');
const binary=path.join(root,'.tools','cloudflared.exe');
const prepareOnly=process.argv.includes('--prepare-only');
const htmlEscape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
if(!prepareOnly&&!fs.existsSync(binary))throw new Error('cloudflared.exe is missing from .tools. See REMOTE_TESTING.md.');
fs.mkdirSync(state,{recursive:true});
const sessionPath=path.join(state,'session.json');
if(fs.existsSync(sessionPath)){
 const old=JSON.parse(fs.readFileSync(sessionPath,'utf8'));
 if(old.pid){
  let alive=false;try{process.kill(old.pid,0);alive=true;}catch{}
  if(alive)throw new Error('A beta-link process is already active. Use its existing URL or stop that process first.');
 }
}
const bootstrapPath=path.join(state,'accounts.json');
let accounts;
if(fs.existsSync(bootstrapPath))accounts=JSON.parse(fs.readFileSync(bootstrapPath,'utf8')).accounts;
else {
 const password=()=>randomBytes(18).toString('base64url');
 accounts=[{role:'doctor',code:'BETA-D01',name:'Врач тестирования',email:'medina@medsense.test',password:password()},
  ...Array.from({length:5},(_,i)=>({role:'patient',code:`BETA-P0${i+1}`,name:`Участник 0${i+1}`,email:`parent${i+1}@medsense.test`,password:password(),synthetic:false})),
  {role:'patient',code:'BETA-QA',name:'Техническая проверка',email:'qa@medsense.test',password:password(),synthetic:true}];
 fs.writeFileSync(bootstrapPath,JSON.stringify({accounts},null,2),{mode:0o600,flag:'wx'});
}
if(!accounts.some(a=>a.code==='TEACHER-D01')) {
 accounts.push({role:'doctor',code:'TEACHER-D01',name:'Преподаватель демо',email:'teacher@medsense.test',password:randomBytes(18).toString('base64url'),synthetic:true},
 {role:'patient',code:'TEACHER-P01',doctorCode:'TEACHER-D01',name:'Демонстрационный пациент',email:'demo@medsense.test',password:randomBytes(18).toString('base64url'),synthetic:true});
 fs.writeFileSync(bootstrapPath,JSON.stringify({accounts},null,2),{mode:0o600});
}
if(prepareOnly){
 fs.writeFileSync(path.join(state,'access.html'),accessPage('#awaiting-publication'),{mode:0o600});
 console.log('Beta credentials prepared locally. No server or tunnel started.');
 console.log('Private access file: '+path.join(state,'access.html'));
 process.exit(0);
}
const originPath=path.join(state,'origin.json');
fs.writeFileSync(originPath,JSON.stringify({origin:null}));
const port=process.env.MEDSENSE_BETA_PORT||'4174';
const app=spawn(process.execPath,[path.join(root,'server.mjs')],{
 cwd:root,env:{...process.env,PORT:port,MEDSENSE_PUBLIC:'1',MEDSENSE_DATA_DIR:path.join(state,'data'),
 MEDSENSE_BOOTSTRAP_PATH:bootstrapPath,MEDSENSE_PUBLIC_ORIGIN_FILE:originPath},stdio:['ignore','pipe','pipe'],windowsHide:true
});
let tunnel,shuttingDown=false,started=false;
function accessPage(url,teacherOnly=false){
 const rows=accounts.filter(a=>teacherOnly?a.code.startsWith('TEACHER-'):a.code!=='BETA-QA').map(a=>`<tr><td>${htmlEscape(a.name)} (${a.role==='doctor'?'врач':'пациент'})</td><td>${htmlEscape(a.email)}</td><td><code>${htmlEscape(a.password)}</code></td></tr>`).join('');
 return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MedSense — доступы Beta</title><style>body{font:16px/1.7 system-ui;max-width:1050px;margin:40px auto;padding:0 22px;color:#18363e}h1{font-size:28px}a{color:#0d827d}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dbe4df;padding:13px;text-align:left}th{background:#e3efea}code{font-size:14px;overflow-wrap:anywhere}.wrap{overflow-x:auto}</style><h1>MedSense — индивидуальные доступы для Beta</h1><p><a href="${htmlEscape(url)}" target="_blank" rel="noreferrer">${htmlEscape(url)}</a></p><p>Каждому человеку отправьте только его строку, а не всю эту страницу. Адреса ниже — логины, письма на них не отправляются. Аккаунты пациентов независимы. Врач видит данные всех пяти пациентов.</p><div class="wrap"><table><tr><th>Кому</th><th>Логин</th><th>Пароль</th></tr>${rows}</table></div><p>Для теста вводите только вымышленные показатели и псевдонимы. Это учебный интерфейс, без экстренного медицинского наблюдения.</p><p>Ссылка доступна, пока компьютер подключён к интернету и программа связи запущена. После повторного запуска адрес меняется, пароли и сохранённые записи остаются. Для остановки нажмите Ctrl+C в окне Beta.</p></html>`;
}
function stop(code=0){
 if(shuttingDown)return;shuttingDown=true;
 if(tunnel&&!tunnel.killed)tunnel.kill();
 if(!app.killed)app.kill();
 fs.writeFileSync(sessionPath,JSON.stringify({pid:null,stoppedAt:new Date().toISOString()}));
 setTimeout(()=>process.exit(code),350);
}
const timer=setTimeout(()=>{console.error('Could not create a beta link within 90 seconds.');stop(1);},90000);
app.stdout.on('data',chunk=>{
 if(started||!chunk.toString().includes('MedSense running'))return;
 started=true;
 tunnel=spawn(binary,['tunnel','--no-autoupdate','--protocol','http2','--url',`http://127.0.0.1:${port}`],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let received='';
 let linked=false;
 const onceRead=chunk=>{
  if(linked)return;
  received=(received+chunk.toString()).slice(-18000);
  const m=received.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if(!m)return;
  linked=true;const url=m[0];
  fs.writeFileSync(originPath,JSON.stringify({origin:url}));
  fs.writeFileSync(path.join(state,'access.html'),accessPage(url),{mode:0o600});
  fs.writeFileSync(path.join(state,'teacher-access.html'),accessPage(url,true),{mode:0o600});
  fs.writeFileSync(sessionPath,JSON.stringify({pid:process.pid,appPid:app.pid,tunnelPid:tunnel.pid,url,startedAt:new Date().toISOString()}));
  clearTimeout(timer);
  console.log(`BETA_URL=${url}\nIndividual credentials: ${path.join(state,'access.html')}\nKeep this process running. Ctrl+C stops the link.`);
 };
 tunnel.stdout.on('data',onceRead);tunnel.stderr.on('data',onceRead);
 tunnel.on('error',err=>{console.error('Tunnel error: '+err.message);stop(1);});
 tunnel.on('exit',code=>{if(!shuttingDown){console.error('Tunnel stopped: '+code);stop(1);}});
});
app.stderr.on('data',chunk=>{const text=chunk.toString();if(!text.includes('ExperimentalWarning'))console.error(text);});
app.on('error',err=>{console.error('Application error: '+err.message);stop(1);});
app.on('exit',code=>{if(!shuttingDown){console.error('Application stopped: '+code);stop(1);}});
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
fs.writeFileSync(sessionPath,JSON.stringify({pid:process.pid,appPid:app.pid,startedAt:new Date().toISOString()}));
