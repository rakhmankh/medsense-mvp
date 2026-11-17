// Local educational guidance. No external model, network request or diagnosis.
export const SOURCES = [
 {title:'American Heart Association · Home monitoring',url:'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home'},
 {title:'American Heart Association · Severe blood pressure',url:'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/when-to-call-911-for-high-blood-pressure'},
 {title:'Kazakhstan · Emergency medical assistance',url:'https://www.gov.kz/situations/55/intro?lang=en'}
];
const words={
 ru:{boundary:'Учебная справка для взрослых. Не диагноз и не медицинское назначение. Не меняйте дозу и не прекращайте лекарства по ответу помощника. План врача имеет приоритет.',
 emergency:'При боли в груди, выраженной одышке, внезапной слабости или онемении, нарушении речи или зрения вызывайте скорую помощь: 103 или 112 в Казахстане. Не ждите ответа в приложении или повторного измерения.',
 severe:'Последняя запись достигла порога 180 мм рт. ст. сверху ИЛИ 120 снизу. Если это актуальное измерение и нет опасных симптомов, повторите его минимум через 1 минуту. Если значение остаётся таким высоким, немедленно свяжитесь с медицинским специалистом. При опасных симптомах — 103 или 112, без ожидания.',
 limited:'При беременности, в послеродовом периоде или возрасте до 18 лет эти общие правила не подходят. Свяжитесь с вашим лечащим врачом для индивидуальной оценки; при внезапном ухудшении — срочная помощь.',
 empty:'Нет сохранённых измерений. Добавьте запись с тонометра; помощник не может оценить давление без данных.',
 stale:'Последняя запись старше 24 часов. Она описывает прошлое измерение, а не ваше состояние сейчас. При необходимости сделайте новое измерение по плану врача.',
 high:'Значение 140 сверху или 90 снизу и выше заслуживает обсуждения с врачом, особенно если повторяется. Одна запись не подтверждает диагноз. Сохраните повторные измерения и покажите историю врачу.',
 low:'Значение ниже 90 сверху или 60 снизу может быть низким для некоторых людей. При головокружении, слабости или повторении обсудите это с врачом. При обмороке или резком ухудшении нужна срочная помощь.',
 other:'По одной записи нельзя определить диагноз или безопасность состояния. Сравнивайте измерения с индивидуальным целевым диапазоном, который установил врач. Продолжайте записи по согласованному плану.',
 technique:'Перед измерением спокойно посидите 5 минут. В течение 30 минут перед ним избегайте курения, кофеина и нагрузки. Спина опирается на спинку, стопы на полу, рука на уровне сердца, подходящая манжета на голой руке. Сделайте 2 измерения с интервалом 1 минута и сохраните оба.',
 doctor:'Спросите врача: какой мой целевой диапазон и график измерений; при каких значениях и симптомах обращаться; подходит ли мой тонометр и манжета? Возьмите историю измерений и список принимаемых лекарств. Отправка данных не означает, что врач увидит их немедленно.',
 summary:'Среднее — простая арифметическая сводка сохранённых записей за последние 14 дней. Нерегулярные измерения могут смещать результат; это не диагноз и не доказательство улучшения или ухудшения.',
 fallback:'Я отвечаю только по готовым темам: последние показатели, сводка за 14 дней, техника измерения и вопросы врачу. Выберите тему ниже. Свободного медицинского диалога в этой версии нет.',
 medication:'Я не подбираю лекарства и не советую менять дозы. Обсудите лечение с врачом; при опасных симптомах обращайтесь за срочной помощью.'},
 en:{boundary:'Educational adult guidance only. This is not a diagnosis or prescription. Do not change doses or stop medication based on this assistant. Your clinician’s plan takes priority.',
 emergency:'For chest pain, severe breathlessness, sudden weakness or numbness, or speech or vision changes, call emergency services: 103 or 112 in Kazakhstan. Do not wait for the app or another measurement.',
 severe:'The latest saved reading reached a safety threshold of systolic 180 OR diastolic 120 mmHg. If this is a current reading and there are no warning symptoms, repeat after at least 1 minute. If it stays this high, contact a medical professional immediately. With warning symptoms, call 103 or 112 without waiting.',
 limited:'During pregnancy, after delivery or below age 18, these general adult rules do not apply. Contact your treating clinician for an individual assessment; seek urgent help for sudden deterioration.',
 empty:'No saved measurements. Add a cuff reading first; the assistant cannot assess blood pressure without data.',
 stale:'The latest saved reading is over 24 hours old. It describes a past measurement, not your condition now. Take a new reading when appropriate under your clinician’s plan.',
 high:'A reading of systolic 140 or diastolic 90 or higher deserves discussion with your clinician, especially if repeated. One reading does not establish a diagnosis. Save repeat measurements and show the history to your clinician.',
 low:'Systolic below 90 or diastolic below 60 may be low for some people. Discuss dizziness, weakness or repeated low readings with your clinician. Fainting or sudden deterioration requires urgent help.',
 other:'One reading cannot establish a diagnosis or guarantee safety. Compare readings with the individual target agreed with your clinician and continue recording as planned.',
 technique:'Rest seated for 5 minutes first. Avoid smoking, caffeine and exercise for 30 minutes beforehand. Support your back, keep feet flat and your arm at heart level; use a correctly sized cuff on a bare arm. Take 2 readings 1 minute apart and save both.',
 doctor:'Ask your clinician about your target range and measurement schedule, when readings or symptoms require contact, and whether your cuff fits. Bring your reading history and medication list. Uploading data does not mean a clinician will see it immediately.',
 summary:'The average is a simple arithmetic summary of saved readings in the last 14 days. Irregular sampling can bias it; this is not a diagnosis or evidence that your condition improved or deteriorated.',
 fallback:'This version supports preset topics only: latest readings, 14-day summary, measurement technique and questions for your clinician. Select a topic below. It does not provide open-ended medical chat.',
 medication:'I cannot choose medicines or recommend dose changes. Discuss treatment with your clinician; seek emergency help for warning symptoms.'}
};
export function buildGuidance(data,input={},now=Date.now()){
 const language=input.language==='en'?'en':'ru',w=words[language];
 const rows=data.readings.filter(r=>Number.isFinite(Date.parse(r.measured_at))&&Date.parse(r.measured_at)<=now).slice().sort((a,b)=>Date.parse(b.measured_at)-Date.parse(a.measured_at)||b.id-a.id);
 const latest=rows[0]||null,recent=rows.filter(r=>Date.parse(r.measured_at)>=now-14*86400000);
 const snapshot={latest:latest?{systolic:latest.systolic,diastolic:latest.diastolic,pulse:latest.pulse,measured_at:latest.measured_at}:null,count14:recent.length,days14:new Set(recent.map(r=>r.measured_at.slice(0,10))).size,average:recent.length?{systolic:Math.round(recent.reduce((s,r)=>s+r.systolic,0)/recent.length),diastolic:Math.round(recent.reduce((s,r)=>s+r.diastolic,0)/recent.length)}:null};
 let topic=input.topic||'latest',q=String(input.question||'').toLowerCase();
 if(q){topic=/лекар|таблет|доз|medicat|dose|pill/.test(q)?'medication':/средн|динамик|summary|average|trend/.test(q)?'summary':/измер|measure|cuff/.test(q)?'technique':/врач|doctor|clinician/.test(q)?'doctor':'fallback';}
 const stale=!!latest&&now-Date.parse(latest.measured_at)>86400000,severe=!!latest&&(latest.systolic>=180||latest.diastolic>=120);
 const sections=[];let urgency='routine';
 if(input.warningSymptoms===true){urgency='emergency';sections.push(w.emergency);}
 else if(input.specialPopulation===true){urgency='clinician';sections.push(w.limited);}
 else if(severe){urgency=stale?'past-severe':'urgent';if(stale)sections.push(w.stale);sections.push(w.severe);}
 else if(!latest)sections.push(w.empty);
 else if(stale)sections.push(w.stale);
 else if(latest.systolic<90||latest.diastolic<60){urgency='clinician';sections.push(w.low);}
 else if(latest.systolic>=140||latest.diastolic>=90){urgency='clinician';sections.push(w.high);}
 else sections.push(w.other);
 if(urgency!=='emergency'&&!input.specialPopulation){
  if(topic==='latest')sections.push(w.doctor);
  else if(topic in w&&['technique','summary','doctor','medication','fallback'].includes(topic))sections.push(w[topic]);
 }
 return {mode:'local-rules',version:'1.0',language,topic,urgency,generatedAt:new Date(now).toISOString(),snapshot,sections,boundary:w.boundary,sources:SOURCES};
}
