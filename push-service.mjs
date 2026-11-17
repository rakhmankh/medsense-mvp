import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

export function validateSubscription(value){
 if(!value||typeof value.endpoint!=='string'||value.endpoint.length>2048)throw new Error('Invalid push subscription');
 const url=new URL(value.endpoint);
 const allowed=url.hostname==='fcm.googleapis.com'||url.hostname==='updates.push.services.mozilla.com'||url.hostname==='web.push.apple.com'||url.hostname.endsWith('.push.apple.com')||url.hostname.endsWith('.notify.windows.com');
 if(url.protocol!=='https:'||url.port||url.username||url.password||!allowed)throw new Error('Unsupported push provider');
 const {p256dh,auth}=value.keys||{};
 if(typeof p256dh!=='string'||typeof auth!=='string'||!/^[\w-]{87}$/.test(p256dh)||!/^[\w-]{22}$/.test(auth))throw new Error('Invalid push keys');
 const key=Buffer.from(p256dh,'base64url');if(key.length!==65||key[0]!==4||Buffer.from(auth,'base64url').length!==16)throw new Error('Invalid push keys');
 return {endpoint:value.endpoint,keys:{p256dh,auth}};
}

export function createPushService(db,dataDir,origin,{transport=webpush}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions(endpoint TEXT PRIMARY KEY,doctor_id INTEGER NOT NULL REFERENCES users(id),subscription TEXT NOT NULL,origin TEXT NOT NULL,session_token TEXT NOT NULL,language TEXT NOT NULL DEFAULT 'ru',created_at TEXT NOT NULL)`);
 const keyFile=path.join(dataDir,'push-vapid.json');
 let keys;
 if(fs.existsSync(keyFile))keys=JSON.parse(fs.readFileSync(keyFile,'utf8'));
 else{keys=webpush.generateVAPIDKeys();fs.writeFileSync(keyFile,JSON.stringify(keys),{flag:'wx',mode:0o600});}
 const token=req=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('medsense_session='))?.slice('medsense_session='.length)||'';
 function save(user,req,value,language){
  const subscription=validateSubscription(value);
  const current=db.prepare('SELECT doctor_id FROM push_subscriptions WHERE endpoint=?').get(subscription.endpoint);
  if(current&&current.doctor_id!==user.id)throw new Error('Sign out of the previous clinician account on this device first');
  const count=db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE doctor_id=?').get(user.id).n;
  if(!current&&count>=10)throw new Error('Maximum 10 notification devices per clinician');
  const locale=['ru','en','kk'].includes(language)?language:'ru';
  db.prepare(`INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription,origin=excluded.origin,session_token=excluded.session_token,language=excluded.language`).run(subscription.endpoint,user.id,JSON.stringify(subscription),origin(),token(req),locale,new Date().toISOString());
 }
 const remove=(doctorId,endpoint)=>db.prepare('DELETE FROM push_subscriptions WHERE doctor_id=? AND endpoint=?').run(doctorId,endpoint);
 const logout=(user,req)=>db.prepare('DELETE FROM push_subscriptions WHERE doctor_id=? AND session_token=?').run(user.id,token(req));
 async function deliver(doctorId,payload){
  const devices=db.prepare('SELECT * FROM push_subscriptions WHERE doctor_id=? AND origin=?').all(doctorId,origin());
  const errors=[];
  const results=await Promise.all(devices.map(async device=>{
   try{
    const body=typeof payload==='function'?payload(device.language):payload;
    const subject=process.env.MEDSENSE_PUSH_SUBJECT||origin();
    await transport.sendNotification(JSON.parse(device.subscription),JSON.stringify(body),{TTL:300,urgency:'normal',timeout:10000,vapidDetails:{subject,publicKey:keys.publicKey,privateKey:keys.privateKey}});
    return true;
   }catch(error){if(error.statusCode===404||error.statusCode===410)remove(doctorId,device.endpoint);let reason='';try{reason=JSON.parse(error.body||'{}').reason||'';}catch{}errors.push({status:error.statusCode||0,reason:/^[A-Za-z0-9_-]{1,80}$/.test(reason)?reason:'DeliveryUnavailable'});console.warn('Push delivery failed',error.statusCode||'network',reason);return false;}
  }));
  return {devices:devices.length,accepted:results.filter(Boolean).length,...(errors.length?{errors}:{})};
 }
 return {publicKey:keys.publicKey,save,remove,logout,deliver,
  notifyReading(patient,reading){
   const bp=`${reading.systolic}/${reading.diastolic}`;
   const copy={
    en:{title:'New reading',body:`${patient.name} added a reading: BP ${bp} mmHg, pulse ${reading.pulse} bpm.`},
    ru:{title:'Новое измерение',body:`${patient.name} загрузил(а) данные: АД ${bp} мм рт. ст., пульс ${reading.pulse} уд/мин.`},
    kk:{title:'Жаңа өлшем',body:`${patient.name} жаңа өлшем қосты: қан қысымы ${bp} мм сын. бағ., тамыр соғысы ${reading.pulse} соғу/мин.`}
   };
   return deliver(patient.doctor_id,language=>{
    const {title,body}=copy[language]||copy.ru;
    return {title:`MedSense · ${title}`,body,patientId:patient.id,tag:`reading-${patient.id}-${reading.id}`};
   });
  }
 };
}
