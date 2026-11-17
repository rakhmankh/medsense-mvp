import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createECDH,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createPushService,validateSubscription} from '../push-service.mjs';
const ecdh=createECDH('prime256v1');ecdh.generateKeys();
const subscription=label=>({endpoint:`https://web.push.apple.com/${label}`,keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}});
test('subscription validation rejects private/local and fake HTTPS endpoints',()=>{
 for(const endpoint of ['http://127.0.0.1:8080','https://localhost/x','https://web.push.apple.com.evil.test/x','https://web.push.apple.com:8443/x'])assert.throws(()=>validateSubscription({...subscription('test'),endpoint}));
 assert.throws(()=>validateSubscription({...subscription('test'),keys:{auth:'bad',p256dh:'bad'}}));
 assert.ok(validateSubscription(subscription('okay')));
});
test('delivery targets the assigned clinician and current origin, logout unbinds the device',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'medsense-push-test-'));
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 let origin='https://one.test';const sent=[];
 const push=createPushService(db,dir,()=>origin,{transport:{sendNotification:async(sub,payload,options)=>{sent.push({endpoint:sub.endpoint,payload:JSON.parse(payload),subject:options.vapidDetails.subject});}}});
 const req={headers:{cookie:'medsense_session=test-session'}};
 push.save({id:1},req,subscription('doctor1'),'kk');push.save({id:2},req,subscription('doctor2'),'en');
 await push.notifyReading({id:3,doctor_id:1,name:'Рахман'},{id:12,systolic:128,diastolic:82,pulse:72});
 assert.equal(sent.length,1);assert.match(sent[0].endpoint,/doctor1/);assert.match(sent[0].payload.body,/Рахман.*128\/82.*72/);
 assert.match(sent[0].payload.title,/Жаңа өлшем/);
 assert.equal(sent[0].subject,'https://one.test');
 origin='https://two.test';assert.equal((await push.deliver(1,{})).devices,0);
 origin='https://one.test';push.logout({id:1},req);assert.equal((await push.deliver(1,{})).devices,0);assert.equal((await push.deliver(2,{})).devices,1);
});
test('expired push endpoints are removed without affecting measurement storage',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'medsense-push-test-')),db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1)');
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const push=createPushService(db,dir,()=> 'https://one.test',{transport:{sendNotification:async()=>{throw {statusCode:410};}}});
 push.save({id:1},{headers:{cookie:'medsense_session=x'}},subscription('expired'),'ru');
 assert.equal((await push.deliver(1,{})).accepted,0);assert.equal((await push.deliver(1,{})).devices,0);
});
