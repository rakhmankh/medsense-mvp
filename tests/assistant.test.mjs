import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildGuidance} from '../assistant-service.mjs';
const now=Date.parse('2026-11-09T12:00:00Z');
const reading=(systolic=120,diastolic=80,extra={})=>({id:1,systolic,diastolic,pulse:72,measured_at:new Date(now-60000).toISOString(),...extra});
const make=(rows,input={})=>buildGuidance({readings:rows},{language:'en',topic:'latest',...input},now);
test('assistant uses either severe-pressure threshold, including exact boundaries',()=>{
 for(const r of [reading(180,80),reading(120,120),reading(190,130)])assert.equal(make([r]).urgency,'urgent');
 assert.equal(make([reading(179,119)]).urgency,'clinician');
});
test('warning symptoms override all readings, empty data and special populations',()=>{
 for(const rows of [[],[reading()],[reading(190,130)]]){const r=make(rows,{warningSymptoms:true,specialPopulation:true});assert.equal(r.urgency,'emergency');assert.match(r.sections[0],/Do not wait/);assert.doesNotMatch(r.sections.join(' '),/repeat after/);}
});
test('stale data and pregnancy are not treated as a current normal assessment',()=>{
 const stale=make([reading(190,130,{measured_at:new Date(now-2*86400000).toISOString()})]);assert.equal(stale.urgency,'past-severe');assert.match(stale.sections[0],/past measurement/);
 assert.match(make([reading()],{specialPopulation:true}).sections[0],/do not apply/);
 assert.match(make([]).sections[0],/No saved/);
});
test('14-day summary excludes old and future readings and calculates saved-record averages',()=>{
 const r=make([reading(120,80),reading(140,90,{id:2}),reading(200,120,{id:3,measured_at:new Date(now-15*86400000).toISOString()}),reading(250,150,{id:4,measured_at:new Date(now+60000).toISOString()})],{topic:'summary'});
 assert.deepEqual(r.snapshot.average,{systolic:130,diastolic:85});assert.equal(r.snapshot.count14,2);assert.equal(r.snapshot.days14,1);assert.equal(r.snapshot.latest.systolic,140);
});
test('medication requests never produce dose guidance and unsupported chat is identified',()=>{
 assert.match(make([reading()],{question:'What medication dose should I take?'}).sections.join(' '),/cannot choose medicines/);
 assert.match(make([reading()],{question:'Tell me a joke'}).sections.join(' '),/preset topics only/);
 assert.equal(make([reading()],{language:'ru'}).mode,'local-rules');
 assert.match(make([reading()],{language:'ru'}).boundary,/Не меняйте дозу/);
});
