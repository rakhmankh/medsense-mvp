import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const components=source.slice(source.indexOf('Object.assign(words.ru,{healthTitle:'),source.indexOf('function renderPatientLegacy'));
const scope=vm.createContext({words:{ru:{},en:{}},lang:'en',localStorage:{getItem:()=>null},e:s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;'),t:k=>scope.words.en[k]||k,icon:()=>'<svg></svg>',fmt:d=>d?new Date(d).toISOString():'—',dateOnly:d=>new Date(d).toISOString().slice(0,10)});
vm.runInContext(components,scope);
const reading=i=>({id:i,systolic:120+i%15,diastolic:80,pulse:72,measured_at:new Date(Date.now()-i*3600000).toISOString(),note:'<script>test</script>'});
const payload=n=>({patient:{id:1},readings:Array.from({length:n},(_,i)=>reading(i)),latest:n?reading(0):null,average:n?{systolic:125,diastolic:80}:null,count14:n,days14:4,reviews:[],rules:{systolic:160,diastolic:100}});
test('empty and single reading do not fabricate a trend or delta',()=>{
 assert.match(scope.PressureChart(payload(0)),/No readings in this period/);
 assert.match(scope.PressureChart(payload(1)),/At least 3 readings/);
 assert.match(scope.MetricStrip(payload(1)),/No comparison data/);
});
test('100 readings retain all chart points and both reference bands',()=>{
 const chart=scope.PressureChart(payload(100));
 assert.equal((chart.match(/data-reading=/g)||[]).length,100);
 assert.equal((chart.match(/class="reference-band"/g)||[]).length,2);
 assert.match(chart,/tabindex="0"/);
});
test('recent list caps rows and escapes notes',()=>{
 const list=scope.ReadingsList(payload(100));
 assert.equal((list.match(/<time>/g)||[]).length,5);
 assert.ok(!list.includes('<script>'));
 assert.match(list,/expand-readings/);
});
test('period switch filters timestamps without changing records',()=>{
 const d=payload(1);d.readings=Array.from({length:4},(_,i)=>({...reading(i),measured_at:new Date(Date.now()-(i+8)*86400000).toISOString()}));
 vm.runInContext('healthPeriod=7',scope);assert.match(scope.PressureChart(d),/No readings in this period/);
 vm.runInContext('healthPeriod=30',scope);assert.equal((scope.PressureChart(d).match(/data-reading=/g)||[]).length,4);
 vm.runInContext('healthPeriod=14',scope);
});
